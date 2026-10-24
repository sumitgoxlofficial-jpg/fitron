import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { DEFAULT_SETTINGS, SettingsSchema, type GiSettings } from "@/lib/domain/gym-intel/settings";
import { SOURCES, SOURCE_KEYS, isSourceKey, type SourceKey } from "@/lib/domain/gym-intel/sources";
import { crmAudit, need, type CrmUser } from "../crm-access";
import { UserError } from "../errors";

// Gym Intelligence: settings, the source register's saved state, and audit. Everything here is Super Admin work unless a function says otherwise.

export const intelAudit = (tx: Prisma.TransactionClient | typeof db, u: { id: string }, text: string, meta?: Prisma.InputJsonValue) => crmAudit(tx, { actorId: u.id, kind: "intel", text, meta });

export async function getSettings(): Promise<GiSettings> {
  const row = await db.giSetting.findUnique({ where: { id: "default" } });
  const parsed = SettingsSchema.safeParse(row?.data ?? {});
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

/** Saves settings after checking every value; a bad value is refused with what is wrong, not quietly changed. */
export async function saveSettings(u: CrmUser, input: unknown) {
  need(u, "intel.manage");
  const parsed = SettingsSchema.safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues.map((i) => `${i.path.join(".") || "settings"}: ${i.message}`).slice(0, 3).join("; "));
  await db.$transaction(async (tx) => {
    await tx.giSetting.upsert({ where: { id: "default" }, create: { id: "default", data: parsed.data }, update: { data: parsed.data } });
    await intelAudit(tx, u, "Collection settings changed");
  });
  return parsed.data;
}

export type SourceRow = (typeof SOURCES)[SourceKey] & { enabled: boolean; config: { requestsPerMinute?: number; endpoint?: string }; lastSuccessAt: Date | null; lastError: string | null; lastErrorAt: Date | null; errorCount: number; recordsFound: number; phonesFound: number; reviewedAt: Date | null; health: "OK" | "ERRORS" | "OFF" | "NEVER_RUN" };

export async function listSources(u: CrmUser): Promise<SourceRow[]> {
  need(u, "intel.view");
  const rows = new Map((await db.giSource.findMany()).map((r) => [r.key, r]));
  return SOURCE_KEYS.map((k) => {
    const r = rows.get(k);
    const enabled = r?.enabled ?? false;
    const health = !enabled ? "OFF" : r?.lastError && (!r.lastSuccessAt || (r.lastErrorAt && r.lastErrorAt > r.lastSuccessAt)) ? "ERRORS" : r?.lastSuccessAt ? "OK" : "NEVER_RUN";
    return { ...SOURCES[k], enabled, config: (r?.config ?? {}) as SourceRow["config"], lastSuccessAt: r?.lastSuccessAt ?? null, lastError: r?.lastError ?? null, lastErrorAt: r?.lastErrorAt ?? null, errorCount: r?.errorCount ?? 0, recordsFound: r?.recordsFound ?? 0, phonesFound: r?.phonesFound ?? 0, reviewedAt: r?.reviewedAt ?? null, health };
  });
}

export const sourceEnabled = async (key: SourceKey) => !!(await db.giSource.findUnique({ where: { key }, select: { enabled: true } }))?.enabled;

/** Turns a source on (only after the person confirms they have reviewed its terms) or off. Limits are kept within safe bounds. */
export async function setSource(u: CrmUser, key: string, i: { enabled: boolean; reviewedTerms?: boolean; requestsPerMinute?: number; endpoint?: string }) {
  need(u, "intel.manage");
  if (!isSourceKey(key)) throw new UserError("Unknown source.");
  const info = SOURCES[key];
  if (i.enabled && info.needsReview && !i.reviewedTerms) throw new UserError(`Read ${info.name}'s terms (${info.licenseUrl || "your licence"}) and confirm you have, before turning it on.`);
  let endpoint: string | undefined;
  if (i.endpoint?.trim()) {
    try {
      const url = new URL(i.endpoint.trim());
      if (url.protocol !== "https:" || url.username || url.password) throw new Error();
      endpoint = url.toString();
    } catch {
      throw new UserError("The endpoint must be an https address with no username or password.");
    }
  }
  const rpm = i.requestsPerMinute === undefined ? undefined : Math.round(i.requestsPerMinute);
  if (rpm !== undefined && (!Number.isFinite(rpm) || rpm < 1 || rpm > 60)) throw new UserError("Requests per minute must be from 1 to 60.");
  const prev = await db.giSource.findUnique({ where: { key } });
  const config = { ...((prev?.config ?? {}) as object), ...(rpm !== undefined ? { requestsPerMinute: rpm } : {}), ...(endpoint ? { endpoint } : {}) };
  await db.$transaction(async (tx) => {
    await tx.giSource.upsert({
      where: { key },
      create: { key, enabled: i.enabled, config, ...(i.enabled && info.needsReview ? { reviewedById: u.id, reviewedAt: new Date() } : {}) },
      update: { enabled: i.enabled, config, ...(i.enabled && info.needsReview ? { reviewedById: u.id, reviewedAt: new Date() } : {}) },
    });
    await intelAudit(tx, u, `${info.name} ${i.enabled ? "turned on" : "turned off"}`, { source: key });
  });
}

/** Records how a collection went, on the source's row. Never stores a credential: only counts and a short message. */
export async function noteSourceRun(key: SourceKey, r: { ok: boolean; records?: number; phones?: number; error?: string }) {
  const msg = r.error?.replace(/\s+/g, " ").slice(0, 300);
  await db.giSource.upsert({
    where: { key },
    create: { key, ...(r.ok ? { lastSuccessAt: new Date(), recordsFound: r.records ?? 0, phonesFound: r.phones ?? 0 } : { lastError: msg, lastErrorAt: new Date(), errorCount: 1 }) },
    update: r.ok ? { lastSuccessAt: new Date(), recordsFound: { increment: r.records ?? 0 }, phonesFound: { increment: r.phones ?? 0 } } : { lastError: msg, lastErrorAt: new Date(), errorCount: { increment: 1 } },
  });
}
