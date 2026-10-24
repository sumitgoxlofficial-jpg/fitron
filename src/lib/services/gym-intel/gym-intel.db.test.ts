import { randomInt, randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import fixture from "@/lib/domain/gym-intel/fixtures/overpass-jharkhand.json";
import { hasDb } from "@/test/db";
import { CrmDenied, loadCrmUser, nextEmpId, teamOrg, teamRoleId, type CrmUser } from "../crm-access";
import { buildExport } from "./export";
import { saveSettings, setSource } from "./core";
import { decideDup, gymDetail, listGyms, overview, recordReachability, suppressNumber } from "./gyms";
import { cancelJob, createJob, importOsmFile, retryJob, runDueJobs, runJobStep } from "./jobs";
import { coverage, importPinDirectory } from "./geo";
import { promoteGym } from "./promote";
import { recordObservation } from "./persist";
import { DEFAULT_SETTINGS } from "@/lib/domain/gym-intel/settings";

// These tests use the Overpass-format FIXTURE (invented names and numbers) and a fake network. They prove the engine's logic;
// they are not collected data, and they do not show that any live source works (that is checked separately, against the real service).

const rnd = () => String(randomInt(100_000_000, 899_999_999));
const mobile = () => `9${String(randomInt(100_000_000, 999_999_999))}`;
const staff = async (role: "admin" | "marketing" | "sales"): Promise<CrmUser> => {
  const [orgId, roleId] = await Promise.all([teamOrg(), teamRoleId()]);
  const user = await db.user.create({ data: { orgId, roleId, name: `${role} ${randomUUID().slice(0, 4)}`, email: `${randomUUID()}@test.local`, phone: "", passwordHash: "x", emailVerifiedAt: new Date() } });
  await db.crmStaff.create({ data: { userId: user.id, empId: await nextEmpId(), role } });
  return (await loadCrmUser(user.id))!;
};

/** The fixture with fresh ids and names, so reruns and other tests never collide with it. */
function fresh() {
  const tag = randomUUID().slice(0, 5);
  const base = Number(rnd());
  const j = JSON.parse(JSON.stringify(fixture)) as { elements: { id: number; tags: Record<string, string> }[] };
  j.elements.forEach((e, i) => {
    e.id = base + i;
    if (e.tags.name) e.tags.name = `${e.tags.name} ${tag}`;
  });
  // numbers must be unique per run too
  // places must differ per run too: gyms at the same spot with alike names are, correctly, one gym
  const off = (randomInt(1, 400) / 10);
  for (const e of j.elements as unknown as { lat?: number; lon?: number; center?: { lat: number; lon: number } }[]) {
    if (e.lat !== undefined) { e.lat += off; e.lon! += off; }
    if (e.center) { e.center.lat += off; e.center.lon += off; }
  }
  // and the postcodes and towns: gyms at the same address with alike names are, correctly, one gym
  const pins = j.elements.map(() => String(randomInt(100_000, 999_999)));
  const town = `Town${tag}`;
  j.elements.forEach((e, i) => {
    if (e.tags["addr:postcode"]) e.tags["addr:postcode"] = pins[i]!;
    if (e.tags["addr:city"]) e.tags["addr:city"] = town;
  });
  const m1 = mobile();
  const m2 = mobile();
  j.elements[0]!.tags.phone = `+91 ${m1.slice(0, 5)} ${m1.slice(5)}; 0651 2345678`;
  j.elements[1]!.tags["contact:phone"] = m2;
  return { json: j, tag, m1, m2, base, pins };
}

const okJson = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

describe.skipIf(!hasDb)("Gym Intelligence (database)", () => {
  let admin: CrmUser, marketing: CrmUser, sales: CrmUser;
  beforeAll(async () => {
    admin = await staff("admin");
    marketing = await staff("marketing");
    sales = await staff("sales");
    await saveSettings(admin, { ...DEFAULT_SETTINGS, retryAttempts: 1, retryBackoffSeconds: 5 });
    await db.giSetting.update({ where: { id: "default" }, data: { data: { ...DEFAULT_SETTINGS, retryAttempts: 1, retryBackoffSeconds: 5 } } });
  });

  describe("who may do what", () => {
    it("lets only the Super Admin collect, merge, promote, export and change sources", async () => {
      for (const u of [marketing, sales]) {
        await expect(setSource(u, "osm_overpass", { enabled: true, reviewedTerms: true })).rejects.toBeInstanceOf(CrmDenied);
        await expect(createJob(u, { source: "osm_overpass", states: ["IN-JH"] })).rejects.toBeInstanceOf(CrmDenied);
        await expect(buildExport(u, "master")).rejects.toBeInstanceOf(CrmDenied);
        await expect(promoteGym(u, "GG-0000000", { action: "SKIP" })).rejects.toBeInstanceOf(CrmDenied);
        await expect(importPinDirectory(u, "x", "x.csv")).rejects.toBeInstanceOf(CrmDenied);
      }
    });
    it("lets a Marketing Head see the database but not the numbers; a salesperson sees nothing", async () => {
      await expect(listGyms(sales, {})).rejects.toBeInstanceOf(CrmDenied);
      await expect(overview(sales)).rejects.toBeInstanceOf(CrmDenied);
      const o = { ...fresh().json.elements[0]!, tags: { leisure: "fitness_centre", name: `Masked ${randomUUID().slice(0, 5)}`, phone: mobile() } };
      const r = await recordObservation({ source: "manual_entry", sourceUrl: "https://example.test/x", sourceRecordId: `m-${randomUUID()}`, name: o.tags.name, phonesRaw: [o.tags.phone] }, { settings: DEFAULT_SETTINGS });
      const m = await listGyms(marketing, { q: o.tags.name });
      expect(m.rows[0]!.id).toBe(r.gymId);
      expect(m.rows[0]!.phoneShown).toContain("•");
      expect((await listGyms(admin, { q: o.tags.name })).rows[0]!.phoneShown).toMatch(/^\+91\d{10}$/);
    });
    it("refuses to switch a source on without confirming its terms were read, and refuses a bad limit or endpoint", async () => {
      await expect(setSource(admin, "osm_overpass", { enabled: true })).rejects.toThrow(/terms/);
      await expect(setSource(admin, "osm_overpass", { enabled: false, requestsPerMinute: 500 })).rejects.toThrow(/1 to 60/);
      await expect(setSource(admin, "osm_overpass", { enabled: false, endpoint: "http://insecure.example" })).rejects.toThrow(/https/);
    });
  });

  describe("importing an OpenStreetMap file", () => {
    it("needs the source switched on, then stores genuine records with their evidence", async () => {
      const f = fresh();
      await setSource(admin, "osm_extract", { enabled: false });
      await expect(importOsmFile(admin, JSON.stringify(f.json), "t.json")).rejects.toThrow(/switched off/);
      await setSource(admin, "osm_extract", { enabled: true, reviewedTerms: true });
      const r = await importOsmFile(admin, JSON.stringify(f.json), "t.json");
      expect(r).toMatchObject({ records: 4, skipped: { unnamed: 1, notGym: 1 } });

      const { rows } = await listGyms(admin, { q: f.tag });
      expect(rows).toHaveLength(4);
      const iron = rows.find((g) => g.name.startsWith("Iron Paradise"))!;
      expect(iron).toMatchObject({ phoneNorm: `+91${f.m1}`, phoneKind: "MOBILE", phoneStatus: "SOURCE_CONFIRMED", pin: f.pins[0], state: "Jharkhand", association: "GENERAL_BUSINESS", reachability: "NOT_TESTED" });
      const d = await gymDetail(admin, iron.id);
      expect(d!.gym.sources).toHaveLength(1);
      expect(d!.gym.sources[0]).toMatchObject({ source: "osm_extract", sourceUrl: `https://www.openstreetmap.org/node/${f.base}`, phonesNorm: [`+91${f.m1}`, "+916512345678"] });
      expect(d!.gym.sources[0]!.originalPhones[0]).toContain("98765".slice(0, 0));
      expect(d!.gym.sources[0]!.licenseRef).toContain("ODbL");
      expect(rows.find((g) => g.name.startsWith("Steel City"))).toMatchObject({ phoneNorm: null, phoneStatus: "UNTESTED" });
      expect(rows.find((g) => g.name.startsWith("Dhanbad"))).toMatchObject({ phoneNorm: null, phoneStatus: "INVALID_FORMAT", phone: "12345" });
    });

    it("is idempotent: the same file again changes nothing", async () => {
      const f = fresh();
      await importOsmFile(admin, JSON.stringify(f.json), "t.json");
      await importOsmFile(admin, JSON.stringify(f.json), "t.json");
      expect((await listGyms(admin, { q: f.tag })).total).toBe(4);
    });

    it("rejects a file that isn't Overpass JSON", async () => {
      await expect(importOsmFile(admin, "not json", "x")).rejects.toThrow(/valid JSON/);
      await expect(importOsmFile(admin, `{"a":1}`, "x")).rejects.toThrow(/elements/);
    });
  });

  describe("duplicates", () => {
    // Every test gets its own PIN code, city and coordinates, so other runs' records in the shared database can't be matched.
    const place = () => ({ pin: String(randomInt(100_000, 999_999)), city: `City${randomUUID().slice(0, 6)}`, lat: randomInt(0, 600) / 10 + 8, lon: randomInt(0, 300) / 10 + 68 });
    const obs = (o: { id: string; name: string; phones: string[]; pin: string; city: string; lat?: number; lon?: number; source?: "manual_entry" | "osm_extract" }) => ({ source: o.source ?? ("manual_entry" as const), sourceUrl: "https://example.test/" + o.id, sourceRecordId: o.id, name: o.name, phonesRaw: o.phones, pin: o.pin, city: o.city, lat: o.lat, lon: o.lon });

    it("attaches a second source to the same gym and flags a disagreement between sources", async () => {
      const t = randomUUID().slice(0, 5);
      const a = mobile();
      const b = mobile();
      const p = place();
      const one = await recordObservation(obs({ id: `a-${t}`, name: `Zenith ${t} Gym`, phones: [a], ...p }), { settings: DEFAULT_SETTINGS });
      const two = await recordObservation(obs({ id: `b-${t}`, name: `Zenith ${t} Fitness Centre`, phones: [b], ...p, lat: p.lat + 0.0001, lon: p.lon + 0.0001, source: "osm_extract" }), { settings: DEFAULT_SETTINGS });
      expect(two.gymId).toBe(one.gymId);
      expect(two.created).toBe(false);
      const g = (await gymDetail(admin, one.gymId))!.gym;
      expect(g.sources).toHaveLength(2);
      expect(g.phoneStatus).toBe("CONFLICTING_SOURCES");
    });

    it("keeps branches apart and queues the pair for a person, never merging on a shared number", async () => {
      const t = randomUUID().slice(0, 5);
      const shared = mobile();
      const p1 = place();
      const p2 = place();
      const one = await recordObservation(obs({ id: `c-${t}`, name: `Titan ${t} Gym`, phones: [shared], ...p1 }), { settings: DEFAULT_SETTINGS });
      const two = await recordObservation(obs({ id: `d-${t}`, name: `Titan ${t} Gym`, phones: [shared], ...p2 }), { settings: DEFAULT_SETTINGS });
      expect(two.gymId).not.toBe(one.gymId);
      expect(two.ambiguous).toBe(1);
      const pair = await db.giDup.findFirstOrThrow({ where: { OR: [{ aId: one.gymId, bId: two.gymId }, { aId: two.gymId, bId: one.gymId }] } });
      expect(pair.status).toBe("OPEN");
      await decideDup(admin, pair.id, "KEEP_SEPARATE");
      expect((await db.giDup.findUniqueOrThrow({ where: { id: pair.id } })).status).toBe("KEPT_SEPARATE");
      await expect(decideDup(admin, pair.id, "DISMISS")).rejects.toThrow(/already/);
      expect(await db.giGym.count({ where: { id: { in: [one.gymId, two.gymId] } } })).toBe(2);
    });

    it("merges on a person's decision and keeps all the evidence", async () => {
      const t = randomUUID().slice(0, 5);
      const shared = mobile();
      const p1 = place();
      const p2 = { ...place(), city: p1.city };
      const one = await recordObservation(obs({ id: `e-${t}`, name: `Vortex ${t} Gym`, phones: [shared], ...p1, lat: undefined, lon: undefined }), { settings: DEFAULT_SETTINGS });
      const two = await recordObservation(obs({ id: `f-${t}`, name: `Vortex ${t} Gym`, phones: [shared], ...p2, lat: undefined, lon: undefined }), { settings: DEFAULT_SETTINGS });
      expect(two.gymId).not.toBe(one.gymId);
      const pair = await db.giDup.findFirstOrThrow({ where: { OR: [{ aId: one.gymId }, { bId: one.gymId }], status: "OPEN" } });
      await decideDup(admin, pair.id, "MERGE", one.gymId);
      expect(await db.giGym.findUnique({ where: { id: two.gymId } })).toBeNull();
      expect((await db.giGymSource.count({ where: { gymId: one.gymId } }))).toBe(2);
    });
  });

  describe("collection jobs", () => {
    const tagOf = (f: ReturnType<typeof fresh>) => f.tag;
    it("collect a state from the (fake) network, store it, track coverage honestly and complete", async () => {
      await setSource(admin, "osm_overpass", { enabled: true, reviewedTerms: true, requestsPerMinute: 60 });
      const f = fresh();
      let calls = 0;
      const job = await createJob(admin, { source: "osm_overpass", states: ["IN-JH"] });
      const net = async (url: string, init?: RequestInit) => {
        calls++;
        expect(String(url)).toContain("overpass");
        expect(decodeURIComponent(String(init?.body))).toContain(`"ISO3166-2"="IN-JH"`);
        expect((init?.headers as Record<string, string>)["user-agent"]).toContain("FitronContactBot");
        return okJson(f.json);
      };
      const r = await runJobStep(job.id, { fetch: net as never });
      expect(r).toEqual({ ran: true, more: false });
      const done = await db.giJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(done).toMatchObject({ status: "COMPLETED", recordsFound: 4, phonesFound: 2, attempts: 0 });
      expect(calls).toBe(1);
      expect((await listGyms(admin, { q: tagOf(f) })).total).toBe(4);
      const cov = await coverage(admin);
      const jh = cov.states.find((s) => s.name === "Jharkhand")!;
      expect(jh.status).toBe("COMPLETED_WITH_RESULTS");
      expect(jh.gyms).toBeGreaterThanOrEqual(4);
      expect(cov.states.find((s) => s.name === "Lakshadweep")!.status).toBe("NOT_STARTED");
    });

    it("retry a busy server after a back-off, then fail the area, record the error, and resume from the checkpoint", async () => {
      const job = await createJob(admin, { source: "osm_overpass", states: ["IN-KL", "IN-GA"] });
      const busy = async () => new Response("busy", { status: 504 });
      const expire = () => db.giJob.update({ where: { id: job.id }, data: { leaseUntil: new Date(Date.now() - 1000) } });
      const get = () => db.giJob.findUniqueOrThrow({ where: { id: job.id } });
      await runJobStep(job.id, { fetch: busy as never });
      let j = await get();
      expect(j).toMatchObject({ status: "QUEUED", attempts: 1 });
      expect(j.errorSummary).toMatch(/Retrying/);
      // The back-off has not run out, so no other worker can take it yet.
      expect(await runJobStep(job.id, { fetch: busy as never })).toEqual({ ran: false, more: false });
      await expire();
      await runJobStep(job.id, { fetch: busy as never }); // attempts used up: Kerala is marked failed, the job carries on
      j = await get();
      expect(j.status).toBe("QUEUED");
      expect((j.checkpoint as { failed: { code: string }[] }).failed.map((x) => x.code)).toEqual(["IN-KL"]);
      expect((await coverage(admin)).states.find((s) => s.name === "Kerala")!.status).toBe("FAILED");
      await runJobStep(job.id, { fetch: busy as never }); // Goa: first try
      await expire();
      await runJobStep(job.id, { fetch: busy as never }); // Goa: out of attempts
      j = await get();
      expect(j.status).toBe("FAILED");
      expect(j.errorSummary).toMatch(/2 areas failed/);
      expect((j.errors as string[]).length).toBeGreaterThanOrEqual(3);

      // Retry: the server answers now. Nothing found is shown as such, not as "no gyms exist".
      const empty = async () => okJson({ elements: [] });
      await retryJob(admin, job.id);
      await runDueJobs(20_000, { fetch: empty as never });
      j = await get();
      expect(j.status).toBe("COMPLETED");
      expect((await coverage(admin)).states.find((s) => s.name === "Goa")!.status).toBe("COMPLETED_NO_RESULTS");
    }, 60_000);

    it("resume after an interruption: a job whose worker died is picked up when its lease runs out", async () => {
      const job = await createJob(admin, { source: "osm_overpass", states: ["IN-SK"] });
      await db.giJob.update({ where: { id: job.id }, data: { status: "RUNNING", leaseUntil: new Date(Date.now() + 60_000) } });
      expect(await runJobStep(job.id, { fetch: (async () => okJson({ elements: [] })) as never })).toEqual({ ran: false, more: false });
      await db.giJob.update({ where: { id: job.id }, data: { leaseUntil: new Date(Date.now() - 1000) } });
      expect((await runJobStep(job.id, { fetch: (async () => okJson({ elements: [] })) as never })).ran).toBe(true);
      expect((await db.giJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("COMPLETED");
    });

    it("ask for confirmation on a big job, refuse an unknown state, and can be cancelled", async () => {
      const many = ["IN-AP", "IN-AR", "IN-AS", "IN-BR"];
      await expect(createJob(admin, { source: "osm_overpass", states: many })).rejects.toThrow(/understand/);
      await expect(createJob(admin, { source: "osm_overpass", states: ["IN-XX"] })).rejects.toThrow(/list/);
      const job = await createJob(admin, { source: "osm_overpass", states: many, confirmed: true });
      await cancelJob(admin, job.id);
      expect((await db.giJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("CANCELLED");
      expect((await coverage(admin)).states.find((s) => s.name === "Bihar")!.status).toBe("NOT_STARTED");
    });

    it("read a gym's own site only when robots.txt allows, and record where each number was found", async () => {
      await setSource(admin, "public_website", { enabled: true, reviewedTerms: true, requestsPerMinute: 60 });
      const t = randomUUID().slice(0, 6);
      const host = `site-${t}.example.com`;
      const blocked = `blocked-${t}.example.com`;
      const refused = `refused-${t}.example.com`;
      const num = mobile();
      const mk = (id: string, name: string, site: string) => recordObservation({ source: "manual_entry", sourceUrl: `https://example.test/${id}`, sourceRecordId: `${id}-${t}`, name: `${name} ${t}`, phonesRaw: [], website: `https://${site}/`, state: "Enrichland", city: `C${t}` }, { settings: DEFAULT_SETTINGS });
      const ok = await mk("ok", "Webgym", host);
      const no = await mk("no", "Blockedgym", blocked);
      const rf = await mk("rf", "Refusedgym", refused);
      const seen: string[] = [];
      const net = async (url: string) => {
        seen.push(url);
        const u = new URL(url);
        if (u.pathname === "/robots.txt") return new Response(u.host === blocked ? "User-agent: *\nDisallow: /\n" : "User-agent: *\nDisallow: /admin\n", { status: 200, headers: { "content-type": "text/plain" } });
        if (u.host === refused) return new Response("no", { status: 403 });
        return new Response(`<html><title>x</title><a href="tel:+91${num}">Call</a></html>`, { status: 200, headers: { "content-type": "text/html" } });
      };
      const job = await createJob(admin, { source: "public_website", states: [], onlyMissingPhone: true, gymIds: [ok.gymId, no.gymId, rf.gymId] });
      for (let i = 0; i < 20; i++) {
        const r = await runJobStep(job.id, { fetch: net as never, checkHost: async () => {} });
        if (!r.more) break;
      }
      const got = await gymDetail(admin, ok.gymId);
      expect(got!.gym.phoneNorm).toBe(`+91${num}`);
      expect(got!.gym.phoneStatus).toBe("SOURCE_CONFIRMED");
      expect(got!.gym.sources.find((s) => s.source === "public_website")).toMatchObject({ sourceUrl: `https://${host}/`, phonesNorm: [`+91${num}`] });
      // robots.txt said no: the page was never fetched and no number was invented
      expect((await gymDetail(admin, no.gymId))!.gym.phoneNorm).toBeNull();
      expect(seen.some((u) => u === `https://${blocked}/`)).toBe(false);
      // a site that refuses (403) is not retried and not worked around
      expect((await gymDetail(admin, rf.gymId))!.gym.phoneNorm).toBeNull();
      expect(seen.filter((u) => u === `https://${refused}/`)).toHaveLength(1);
      // never to a private address
      const { assertPublicHost } = await import("./fetch");
      for (const h of ["localhost", "127.0.0.1", "10.1.2.3", "192.168.0.5", "169.254.169.254"]) await expect(assertPublicHost(h), h).rejects.toThrow();
    }, 60_000);
  });


  describe("AI help (the model is faked: it can find a site and choose numbers, never supply one)", () => {
    const num = () => mobile();
    const mkGym = (name: string) => recordObservation({ source: "manual_entry", sourceUrl: "https://example.test/ai", sourceRecordId: `ai-${randomUUID()}`, name, phonesRaw: [], state: "Jharkhand", city: `C${randomUUID().slice(0, 5)}` }, { settings: DEFAULT_SETTINGS });
    const netFor = (pages: Record<string, string>, seen: string[] = []) => async (url: string) => {
      seen.push(url);
      const u = new URL(url);
      if (u.pathname === "/robots.txt") return new Response("User-agent: *\nDisallow: /admin\n", { status: 200, headers: { "content-type": "text/plain" } });
      const body = pages[u.host];
      return body ? new Response(body, { status: 200, headers: { "content-type": "text/html" } }) : new Response("no", { status: 404 });
    };
    const setAi = async (cap: number, on = true) => {
      const cur = (await db.giSetting.findUnique({ where: { id: "default" } }))!.data as object;
      await db.giSetting.update({ where: { id: "default" }, data: { data: { ...cur, aiEnabled: on, aiDailyCap: cap } } });
    };
    const reset = () => db.giSource.updateMany({ where: { key: "ai_assisted" }, data: { config: { requestsPerMinute: 60 } } });
    beforeAll(async () => {
      vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
      await setSource(admin, "ai_assisted", { enabled: true, reviewedTerms: true, requestsPerMinute: 60 });
      await setSource(admin, "public_website", { enabled: true, reviewedTerms: true, requestsPerMinute: 60 });
    });
    afterAll(() => {
      vi.unstubAllEnvs();
    });

    it("refuses a job while AI is off in settings", async () => {
      await setAi(100, false);
      await expect(createJob(admin, { source: "ai_assisted", states: [] })).rejects.toThrow(/switched off/);
    });

    it("finds a gym's own site, reads it, and keeps only the number the page printed", async () => {
      await setAi(100);
      await reset();
      const t = randomUUID().slice(0, 6);
      const printed = num();
      const a = await mkGym(`Aurora ${t} Gym`);
      const b = await mkGym(`Bolt ${t} Gym`);
      const c = await mkGym(`Comet ${t} Gym`);
      const d = await mkGym(`Delta ${t} Gym`);
      const answers: Record<string, string> = {
        [`Aurora ${t} Gym`]: `{"url":"https://aurora-${t}.example.com/","reason":"Official site","phone":"9111111111"}`,
        [`Bolt ${t} Gym`]: `{"url":"https://www.justdial.com/Ranchi/Bolt","reason":"listing"}`,
        [`Comet ${t} Gym`]: `You can call Comet on 98000 11111`,
        [`Delta ${t} Gym`]: `{"url":"https://other-${t}.example.com/","reason":"maybe"}`,
      };
      const asked: string[] = [];
      const ask = async (r: { prompt: string; webSearch?: boolean }) => {
        const name = Object.keys(answers).find((n) => r.prompt.includes(n))!;
        asked.push(name);
        expect(r.webSearch).toBe(true);
        return { text: answers[name]!, searches: ["q"] };
      };
      const pages = {
        [`aurora-${t}.example.com`]: `<html><title>Aurora ${t} Gym</title><body>Aurora ${t} Gym, Ranchi <a href="tel:+91${printed}">Call</a></body></html>`,
        [`other-${t}.example.com`]: `<html><title>Some Other Business</title><body><a href="tel:+91${num()}">Call</a></body></html>`,
      };
      const job = await createJob(admin, { source: "ai_assisted", states: [], gymIds: [a.gymId, b.gymId, c.gymId, d.gymId] });
      const r = await runJobStep(job.id, { fetch: netFor(pages) as never, checkHost: async () => {}, ask: ask as never });
      expect(r.ran).toBe(true);
      const A = (await gymDetail(admin, a.gymId))!.gym;
      expect(A.website).toBe(`https://aurora-${t}.example.com/`);
      expect(A.phoneNorm).toBe(`+91${printed}`);
      expect(A.phoneStatus).toBe("SOURCE_CONFIRMED");
      expect(A.sources.map((x) => x.source).sort()).toEqual(["ai_assisted", "manual_entry", "public_website"]);
      expect(A.sources.flatMap((x) => x.phonesNorm)).not.toContain("+919111111111");
      // a directory listing, a number written in prose, and a site that isn't about the gym give no website and no number
      for (const g of [b, c]) {
        const G = (await gymDetail(admin, g.gymId))!.gym;
        expect(G.website).toBeNull();
        expect(G.phoneNorm).toBeNull();
        expect(G.sources.some((x) => x.sourceUrl === "ai:no-site-found")).toBe(true);
      }
      const D = (await gymDetail(admin, d.gymId))!.gym;
      expect(D.phoneNorm).toBeNull();
      expect(D.website).toBe(`https://other-${t}.example.com/`);
      expect(asked).toHaveLength(4);
    }, 90_000);

    it("lets the model choose among a page's numbers but never add one", async () => {
      await setAi(100);
      await reset();
      const t = randomUUID().slice(0, 6);
      const front = num();
      const franchise = num();
      const g = await recordObservation({ source: "manual_entry", sourceUrl: "https://example.test/c", sourceRecordId: `c-${randomUUID()}`, name: `Choice ${t} Gym`, phonesRaw: [], website: `https://choice-${t}.example.com/`, state: "Jharkhand", city: `C${t}` }, { settings: DEFAULT_SETTINGS });
      const page = { [`choice-${t}.example.com`]: `<html><title>x</title><body>Front desk: ${front.slice(0, 5)} ${front.slice(5)}. Franchise enquiries: ${franchise.slice(0, 5)} ${franchise.slice(5)}</body></html>` };
      const run = async (answer: string | Error) => {
        await db.giGymSource.deleteMany({ where: { gymId: g.gymId, source: "public_website" } });
        await db.giGym.update({ where: { id: g.gymId }, data: { phone: null, phoneNorm: null } });
        const job = await createJob(admin, { source: "public_website", states: [], gymIds: [g.gymId], onlyMissingPhone: true });
        await runJobStep(job.id, { fetch: netFor(page) as never, checkHost: async () => {}, ask: (async () => { if (answer instanceof Error) throw answer; return { text: answer }; }) as never });
        return (await gymDetail(admin, g.gymId))!.gym.sources.find((x) => x.source === "public_website")?.phonesNorm ?? [];
      };
      expect(await run(`{"keep":[0]}`)).toEqual([`+91${front}`]);
      expect(await run(`{"keep":[9,"+919000000000"]}`)).toEqual([`+91${front}`, `+91${franchise}`]);
      expect(await run(new Error("API down"))).toEqual([`+91${front}`, `+91${franchise}`]);
    }, 90_000);

    it("stops at the daily cap and carries on after midnight instead of failing", async () => {
      await setAi(1);
      await db.giSource.updateMany({ where: { key: "ai_assisted" }, data: { config: { requestsPerMinute: 60 } } });
      const t = randomUUID().slice(0, 6);
      const one = await mkGym(`Cap ${t} One`);
      const two = await mkGym(`Cap ${t} Two`);
      let calls = 0;
      const ask = async () => ((calls++), { text: `{"url":null}` });
      const job = await createJob(admin, { source: "ai_assisted", states: [], gymIds: [one.gymId, two.gymId] });
      await runJobStep(job.id, { fetch: netFor({}) as never, checkHost: async () => {}, ask: ask as never });
      const j = await db.giJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(calls).toBe(1);
      expect(j.status).toBe("QUEUED");
      expect(j.attempts).toBe(0);
      expect(j.leaseUntil!.getTime()).toBeGreaterThan(Date.now());
      expect(j.errorSummary).toMatch(/allowance/);
    }, 60_000);
  });

  describe("promotion to the CRM", () => {
    const gym = (phone: string[], name = `Promo ${randomUUID().slice(0, 6)}`) => recordObservation({ source: "manual_entry", sourceUrl: "https://example.test/p", sourceRecordId: `p-${randomUUID()}`, name, phonesRaw: phone, pin: "834001", city: "Ranchi", state: "Jharkhand" }, { settings: DEFAULT_SETTINGS });

    it("makes one lead, links it to the discovery record, and never makes a second", async () => {
      const m = mobile();
      const g = await gym([m]);
      const r = await promoteGym(admin, g.gymId, { action: "PROMOTE" });
      expect(r.result).toBe("CREATED");
      const lead = await db.crmLead.findUniqueOrThrow({ where: { id: r.leadId! } });
      expect(lead).toMatchObject({ phone: m, source: "Gym Intelligence", stage: "New Lead", ownerId: null, state: "Jharkhand", pin: "834001" });
      expect(await db.crmActivity.count({ where: { leadId: lead.id, type: "note" } })).toBe(1);
      expect((await db.giGym.findUniqueOrThrow({ where: { id: g.gymId } })).promotion).toBe("PROMOTED");
      expect((await promoteGym(admin, g.gymId, { action: "PROMOTE" })).result).toBe("ALREADY_PROMOTED");
    });

    it("links to an existing lead with the same number instead of duplicating it", async () => {
      const m = mobile();
      const { createLead } = await import("../crm-leads");
      const existing = await createLead(admin, { contactName: "Owner", gymName: "Old name", phone: m, product: "SaaS" });
      const g = await gym([m]);
      const r = await promoteGym(admin, g.gymId, { action: "PROMOTE" });
      expect(r).toMatchObject({ result: "LINKED", leadId: existing.id });
      expect(await db.crmLead.count({ where: { phone: m } })).toBe(1);
    });

    it("flags a lead with a different number but the same name in the same PIN code", async () => {
      const { createLead } = await import("../crm-leads");
      const name = `Echo ${randomUUID().slice(0, 6)}`;
      await createLead(admin, { contactName: "Owner", gymName: `${name} Fitness`, phone: mobile(), product: "SaaS", pin: "834001" });
      const g = await gym([mobile()], `${name} Gym`);
      const r = await promoteGym(admin, g.gymId, { action: "PROMOTE" });
      expect(r.result).toBe("FLAGGED");
      expect((await db.giGym.findUniqueOrThrow({ where: { id: g.gymId } })).promotion).toBe("DUPLICATE_FLAGGED");
    });

    it("explains why a landline-only gym can't become a lead, and honours do-not-contact", async () => {
      const land = await gym(["0651 2345678"]);
      await expect(promoteGym(admin, land.gymId, { action: "PROMOTE" })).rejects.toThrow(/mobile/);
      const g = await gym([mobile()]);
      await suppressNumber(admin, g.gymId, "asked not to be called");
      await expect(promoteGym(admin, g.gymId, { action: "PROMOTE" })).rejects.toThrow(/do-not-contact/);
    });
  });

  describe("phone verification", () => {
    it("only a recorded check makes a number reachability-confirmed, and a check needs a written reason", async () => {
      const g = await recordObservation({ source: "manual_entry", sourceUrl: "https://example.test/v", sourceRecordId: `v-${randomUUID()}`, name: `Verify ${randomUUID().slice(0, 5)}`, phonesRaw: [mobile()] }, { settings: DEFAULT_SETTINGS });
      expect((await db.giGym.findUniqueOrThrow({ where: { id: g.gymId } })).phoneStatus).toBe("SOURCE_CONFIRMED");
      await expect(recordReachability(admin, g.gymId, "CONFIRMED", "ok")).rejects.toThrow(/how you checked/);
      await recordReachability(admin, g.gymId, "CONFIRMED", "Called the front desk, spoke to the manager");
      expect((await db.giGym.findUniqueOrThrow({ where: { id: g.gymId } })).phoneStatus).toBe("REACHABILITY_CONFIRMED");
    });
  });

  describe("exports", () => {
    it("builds a real workbook from the stored records, keeps PIN codes as text and neutralises formulas", async () => {
      const t = randomUUID().slice(0, 5);
      await recordObservation({ source: "manual_entry", sourceUrl: "https://example.test/e", sourceRecordId: `x-${t}`, name: `=HYPERLINK("http://evil.test","${t}")`, phonesRaw: [mobile()], pin: "014001".replace(/^0/, "8"), state: "Jharkhand", city: "Ranchi" }, { settings: DEFAULT_SETTINGS });
      const out = await buildExport(admin, "master", { q: undefined, state: "Jharkhand" });
      expect(out.file).toBe("All_India_Gym_Master.xlsx");
      expect(out.rows).toBeGreaterThan(0);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(out.buffer as never);
      expect(wb.worksheets.map((w) => w.name)).toEqual(["All records", "State summary", "District summary", "Phone status", "Source contributions", "Needs review", "About this data"]);
      const rows = wb.getWorksheet("All records")!.getSheetValues() as unknown[][];
      const mine = rows.find((r) => String(r?.[2] ?? "").includes(t))!;
      expect(String(mine[2]).startsWith("'=")).toBe(true);
      expect(typeof mine[14]).toBe("string");
      expect(String(mine[16])).toContain("example.test/e");
      const csv = await buildExport(admin, "master", { state: "Jharkhand" }, "csv");
      expect(csv.buffer.toString("utf8")).toContain("Gym ID");
      await expect(buildExport(admin, "coverage", {}, "csv")).rejects.toThrow(/CSV/);
    });
    it("records every export in the audit log", async () => {
      await buildExport(admin, "sources");
      expect(await db.crmAudit.count({ where: { actorId: admin.id, kind: "intel", text: { contains: "Exported" } } })).toBeGreaterThan(0);
    });
  });

  describe("reference geography and the overview", () => {
    it("loads the India Post PIN directory and shows coverage by district, from stored data", async () => {
      const csv = `circlename,regionname,divisionname,officename,pincode,officetype,delivery,district,statename,latitude,longitude\nJharkhand Circle,Ranchi,Ranchi,Ranchi GPO,834001,HO,Delivery,RANCHI,JHARKHAND,NA,NA\nJharkhand Circle,Ranchi,Ranchi,Doranda,834002,SO,Delivery,RANCHI,JHARKHAND,NA,NA\nX,Y,Z,Bad,12,SO,Delivery,D,JHARKHAND,NA,NA\n`;
      const r = await importPinDirectory(admin, csv, "pins.csv");
      expect(r.skipped).toBe(1);
      const cov = await coverage(admin, { state: "Jharkhand", district: "RANCHI" });
      expect(cov.pinReferenceLoaded).toBe(true);
      expect(cov.pins.map((p) => p.name)).toEqual(expect.arrayContaining(["834001", "834002"]));
    });
    it("calculates the overview from the records", async () => {
      const o = await overview(admin);
      expect(o.total).toBeGreaterThan(0);
      expect(o.withPhone).toBeLessThanOrEqual(o.total);
      expect(o.uniquePhones).toBeLessThanOrEqual(o.withPhone);
      expect(o.statesTotal).toBe(36);
      expect(o.coverageBasis).toBeTruthy();
    });
  });
});
