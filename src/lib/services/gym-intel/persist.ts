import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { stateByName } from "@/lib/domain/gym-intel/constants";
import { compareGyms, type GymLike, type MatchThresholds } from "@/lib/domain/gym-intel/match";
import { choosePrimary, parsePhone, parsePublished, phoneStatusFor } from "@/lib/domain/gym-intel/phone";
import type { GiSettings } from "@/lib/domain/gym-intel/settings";
import { SOURCES } from "@/lib/domain/gym-intel/sources";
import { cleanPin, domainOf, nameCore, normalizeName, webUrl } from "@/lib/domain/gym-intel/text";
import type { Observation } from "@/lib/domain/gym-intel/types";
import { isUniqueViolation } from "../errors";

type Tx = Prisma.TransactionClient;

export type RecordResult = { gymId: string; created: boolean; phones: number; ambiguous: number };

const thresholds = (s: GiSettings): MatchThresholds => ({ sameName: s.sameNameThreshold, ambiguousName: s.ambiguousNameThreshold, nearMeters: s.nearMeters, farMeters: 1500, addressSame: 0.6 });

type GymWithSources = Prisma.GiGymGetPayload<{ include: { sources: true } }>;

const asLike = (g: GymWithSources): GymLike => ({ name: g.name, phones: [...new Set(g.sources.flatMap((s) => s.phonesNorm))], domain: g.domain, address: g.address, pin: g.pin, city: g.city, lat: g.lat, lon: g.lon, sourceKeys: g.sources.map((s) => `${s.source}:${s.sourceRecordId}`) });

/** Recomputes a gym's headline phone, kind and status from everything its sources have said. */
export async function refreshGym(tx: Tx, gymId: string, settings: GiSettings, now = new Date()) {
  const g = await tx.giGym.findUniqueOrThrow({ where: { id: gymId }, include: { sources: true } });
  const sets = g.sources.map((s) => s.phonesNorm).filter((s) => s.length);
  const kinds = new Map<string, NonNullable<ReturnType<typeof parsePhone>>["kind"]>();
  for (const e of new Set(sets.flat())) {
    const p = parsePhone(e);
    if (p) kinds.set(e, p.kind);
  }
  // Toll-free numbers are only accepted as a gym's number if the settings say so.
  const usable = sets.map((s) => s.filter((n) => settings.acceptTollFree || kinds.get(n) !== "TOLL_FREE"));
  const primary = choosePrimary(usable, kinds);
  const rawAny = g.sources.flatMap((s) => s.originalPhones).find(Boolean) ?? null;
  const original = primary ? (g.sources.flatMap((s) => s.originalPhones.map((o, i) => ({ o, n: s.phonesNorm[i] }))).find((x) => x.n === primary)?.o ?? primary) : rawAny;
  const suppressed = primary ? !!(await tx.giSuppression.findUnique({ where: { phoneNorm: primary } })) : false;
  const status = phoneStatusFor({
    hasNumber: !!(primary || rawAny),
    validFormat: !!primary,
    sourceSets: usable,
    primary,
    lastChecked: g.lastChecked,
    staleDays: settings.staleAfterDays,
    now,
    reachabilityConfirmed: g.reachability === "CONFIRMED",
    unavailable: g.reachability === "UNREACHABLE",
  });
  await tx.giGym.update({
    where: { id: gymId },
    data: { phone: original, phoneNorm: primary, phoneKind: primary ? (kinds.get(primary) ?? null) : null, phoneStatus: status, ...(suppressed ? { promotion: "DO_NOT_CONTACT" } : {}) },
  });
}

/** Saves one observation: attaches it to the gym it is the same business as, or makes a new gym, and queues ambiguous matches for a person. */
export async function recordObservation(o: Observation, ctx: { jobId?: string | null; settings: GiSettings; now?: Date; attachTo?: string }): Promise<RecordResult> {
  try {
    return await db.$transaction((tx) => record(tx, o, ctx), { timeout: 30_000 });
  } catch (e) {
    // Two workers saw the same record at once: the other one made it, so this one just attaches.
    if (isUniqueViolation(e)) return db.$transaction((tx) => record(tx, o, ctx), { timeout: 30_000 });
    throw e;
  }
}

async function record(tx: Tx, o: Observation, ctx: { jobId?: string | null; settings: GiSettings; now?: Date; attachTo?: string }): Promise<RecordResult> {
  const now = ctx.now ?? new Date();
  const info = SOURCES[o.source];
  const parsed = parsePublished(o.phonesRaw.join(";"));
  const phonesNorm = parsed.valid.map((p) => p.e164);
  const originalPhones = [...parsed.valid.map((p) => p.original), ...parsed.invalid];
  // originalPhones and phonesNorm line up for the valid ones, which come first
  const name = o.name.trim().slice(0, 200);
  const website = webUrl(o.website);
  const domain = domainOf(website);
  const pin = cleanPin(o.pin);
  const st = stateByName(o.state)?.name ?? (o.state?.trim() || null);
  const geo = pin ? await tx.giGeo.findFirst({ where: { level: "PIN", code: pin }, select: { state: true, district: true, locality: true } }) : null;
  const fields = { address: o.address?.trim() || null, state: st ?? geo?.state ?? null, district: o.district?.trim() || geo?.district || null, city: o.city?.trim() || null, locality: o.locality?.trim() || geo?.locality || null, pin, lat: o.lat ?? null, lon: o.lon ?? null, website, domain };
  const evidence = (o.evidence ?? {}) as Prisma.InputJsonValue;
  const sourceData = { sourceUrl: o.sourceUrl, originalName: name, originalPhones, phonesNorm, originalAddress: fields.address, evidence, licenseRef: info.license, jobId: ctx.jobId ?? null, lastCheckedAt: now };

  const known = await tx.giGymSource.findUnique({ where: { source_sourceRecordId: { source: o.source, sourceRecordId: o.sourceRecordId } } });
  let gymId: string;
  let created = false;
  let ambiguous = 0;

  if (known) {
    gymId = known.gymId;
    await tx.giGymSource.update({ where: { id: known.id }, data: sourceData });
  } else if (ctx.attachTo) {
    // Another look at a gym we already hold (its own website): attach, never match.
    gymId = ctx.attachTo;
    await tx.giGymSource.create({ data: { gymId, source: o.source, sourceRecordId: o.sourceRecordId, collectedAt: now, ...sourceData } });
  } else {
    const th = thresholds(ctx.settings);
    const incoming: GymLike = { name, phones: phonesNorm, domain, address: fields.address, pin, city: fields.city, lat: fields.lat, lon: fields.lon, sourceKeys: [`${o.source}:${o.sourceRecordId}`] };
    const core = nameCore(name).split(" ")[0] ?? "";
    const where: Prisma.GiGymWhereInput[] = [];
    if (phonesNorm.length) where.push({ sources: { some: { phonesNorm: { hasSome: phonesNorm } } } });
    if (domain) where.push({ domain });
    if (pin) where.push({ pin });
    if (core.length >= 3 && fields.city) where.push({ nameNorm: { contains: core }, city: { equals: fields.city, mode: "insensitive" } });
    const candidates = where.length ? await tx.giGym.findMany({ where: { OR: where }, include: { sources: true }, take: 80 }) : [];
    const scored = candidates.map((c) => ({ c, r: compareGyms(asLike(c), incoming, th) }));
    const same = scored.filter((x) => x.r.decision === "SAME").sort((a, b) => b.r.score - a.r.score)[0];
    if (same) {
      gymId = same.c.id;
    } else {
      const [{ n }] = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('"GiGymSeq"') AS n`;
      gymId = `GG-${String(n).padStart(7, "0")}`;
      await tx.giGym.create({ data: { id: gymId, name, nameNorm: normalizeName(name), ...fields, category: o.category ?? "gym", firstSeen: now, lastSeen: now, lastChecked: now } });
      created = true;
      const maybe = scored.filter((x) => x.r.decision === "AMBIGUOUS");
      if (maybe.length) {
        const group = maybe.find((m) => m.c.dupGroup)?.c.dupGroup ?? `DG-${randomUUID().slice(0, 8)}`;
        await tx.giGym.updateMany({ where: { id: { in: [gymId, ...maybe.map((m) => m.c.id)] } }, data: { dupGroup: group } });
        for (const m of maybe) {
          const [aId, bId] = [m.c.id, gymId].sort() as [string, string];
          await tx.giDup.upsert({ where: { aId_bId: { aId, bId } }, create: { aId, bId, score: m.r.score, reasons: m.r.reasons }, update: {} });
        }
        ambiguous = maybe.length;
      }
    }
    await tx.giGymSource.create({ data: { gymId, source: o.source, sourceRecordId: o.sourceRecordId, collectedAt: now, ...sourceData } });
  }

  // Fill what the gym record is missing from this observation; never overwrite what is there.
  const g = await tx.giGym.findUniqueOrThrow({ where: { id: gymId } });
  const fill: Prisma.GiGymUpdateInput = { lastSeen: now, lastChecked: now };
  for (const k of ["address", "state", "district", "city", "locality", "pin", "website", "domain", "lat", "lon"] as const) if ((g[k] === null || g[k] === undefined) && fields[k] != null) (fill as Record<string, unknown>)[k] = fields[k];
  await tx.giGym.update({ where: { id: gymId }, data: fill });
  await refreshGym(tx, gymId, ctx.settings, now);
  return { gymId, created, phones: phonesNorm.length, ambiguous };
}
