# Gym Intelligence

Finds gym businesses' **publicly published** phone numbers from permitted sources, keeps the evidence for each, lets a Super Admin review
and de-duplicate them, and turns eligible gyms into CRM leads. It lives inside the existing FITRON CRM (`/crm`), uses its sign-in and
roles, and its Postgres database. It is not a separate application.

Phases 1–4 are built: the discovery engine, the data model, the services and exports, and the ten Super Admin pages under **Gym Intelligence**
in the CRM menu (Overview, Gym discovery, India gym database, Phone verification, Geographic coverage, Sources & integrations, Duplicate
review, Import & export, Collection settings, Audit logs). CRM analytics are phase 4; see "Status".

## Integration map (what was inspected, and what this extends)

| Part | What FITRON has | What Gym Intelligence does with it |
|---|---|---|
| Framework | Next.js 16 App Router, server actions, route handlers (TypeScript) | New services in `src/lib/services/gym-intel/`, pure rules in `src/lib/domain/gym-intel/`. The brief's Python/FastAPI modules are written in TypeScript to fit; each has the same job (see "Module map"). |
| Database | Postgres through Prisma 7; row-level security on every table (`rls.db.test.ts`) | Eight `Gi*` tables in migration `20261024194302_gym_intel`, RLS on all. No second database. |
| Auth and roles | `src/lib/auth/crm.ts`, the permission matrix in `src/lib/domain/crm.ts` | Two new permissions: `intel.view` (Super Admin, Marketing Head; numbers masked without `phone.full`) and `intel.manage` (Super Admin only: jobs, sources, settings, merges, promotion, exports). |
| CRM leads | `CrmLead` with a unique 10-digit mobile `phone`, stages, owner, `createLead`, `assignLead` | Promotion calls the same `createLead`; the gym keeps its own discovery status and links to the lead (`GiGym.leadId`). Pipeline stages are CRM's own; discovery status is separate. |
| Audit | Append-only `CrmAudit` (database triggers) | Every collection, merge, review, promotion and export is written with kind `intel`. Phone numbers are scrubbed from audit text. |
| Scheduled work | GitHub Actions calls `/api/jobs/*` with `CRON_SECRET` (`.github/workflows/jobs.yml`) | New `/api/jobs/intel` worker, called at :10 and :40 past each hour. |
| Exports | CSV with a formula guard | `exceljs` workbooks, every cell text, formulas neutralised. |
| Deployment | Vercel (functions up to 300 s) + Supabase | Collection runs in short, resumable steps so no step exceeds a function's time. |

## Module map (brief → code)

| Brief | File |
|---|---|
| `source_registry` | `src/lib/domain/gym-intel/sources.ts` (+ `services/gym-intel/core.ts` for on/off state) |
| `geographic_job_generator` | `jobs.ts` `createJob` (one job step per state/UT), `geo.ts` `seedStates` |
| `osm_adapter` | `domain/gym-intel/osm.ts` (query + parser), `services/gym-intel/adapters.ts` `discoverOsmState` |
| `public_website_adapter` | `domain/gym-intel/website.ts` (robots.txt, contact extraction), `adapters.ts` `readGymSite`, `fetch.ts` |
| `directory_adapter` | Licensed-dataset file import only (see "Sources"). No directory is scraped. |
| `discovery_service`, `job_worker`, `collection_queue` | `services/gym-intel/jobs.ts` (`runJobStep`, `runDueJobs`; the queue is the `GiJob` table with a lease) |
| `enrichment_service` | `jobs.ts` `enrichStep` |
| `phone_extractor`, `phone_normalizer` | `domain/gym-intel/phone.ts` (libphonenumber-js, the JavaScript port of `phonenumbers`) |
| `business_matcher`, `deduplication_service` | `domain/gym-intel/match.ts`, `text.ts` (Jaro–Winkler and token-set similarity; RapidFuzz's job), `services/gym-intel/persist.ts`, `gyms.ts` `decideDup` |
| `provenance_service` | `GiGymSource` rows, written by `persist.ts` |
| `coverage_service` | `services/gym-intel/geo.ts` `coverage` |
| `crm_lead_sync` | `services/gym-intel/promote.ts` |
| `export_service` | `services/gym-intel/export.ts`, `app/api/crm/intel/export/route.ts` |

## Data model

`GiGym` (the gym; headline phone, status, address, PIN, link to a lead), `GiGymSource` (one row per source observation: URL, record id,
the original text, the licence, collection and re-check times), `GiJob` (a collection job and its checkpoint), `GiGeo` (states/UTs, then PIN
codes from the India Post directory, with search status), `GiSource` (a source's on/off state, review and health), `GiSetting`,
`GiDup` (possible duplicates awaiting a person), `GiSuppression` (do-not-contact numbers).

Phone statuses: `UNTESTED`, `FORMAT_VALID`, `SOURCE_CONFIRMED`, `REACHABILITY_CONFIRMED`, `INVALID_FORMAT`, `CONFLICTING_SOURCES`,
`STALE`, `UNAVAILABLE`. Only a recorded, written verification by a Super Admin can produce `REACHABILITY_CONFIRMED`. A number printed by a
source is `SOURCE_CONFIRMED`: it means a source published it, not that it works.

A number is a gym's **business** number. It is labelled `GENERAL_BUSINESS` unless a person records public evidence that it is the owner's.

## Sources (licence register)

Every source starts **off**. A Super Admin turns one on in Sources and integrations after confirming they have read its terms; who and when is saved.

| Source | Terms | How it is used |
|---|---|---|
| OpenStreetMap through Overpass | ODbL 1.0, © OpenStreetMap contributors. https://www.openstreetmap.org/copyright | One state per query, at most 60 requests a minute (default 6), identified user agent. The public Nominatim geocoder is **not** used. Attribution is kept in each record and in every export. |
| OpenStreetMap extract (upload) | ODbL 1.0 | An Overpass JSON file a Super Admin uploads (up to about 4 MB); nothing is fetched. |
| A gym's own website | The site's terms and robots.txt | Only for a website already on the gym record. robots.txt is read first and obeyed. A 403 or 429 is not retried or worked around. Private addresses are refused. |
| AI website finder (Claude web search) | Anthropic commercial terms; each page keeps its own terms | For a gym with no website and no phone, Claude searches the web for the gym's **own** website and returns an address. Directory, map and social pages (Google, Facebook, Instagram, Justdial, Sulekha, IndiaMART…) are refused. The site is then read like any other (robots.txt obeyed), and only if its text mentions the gym. A phone number the model writes is never used. Off until a Super Admin ticks AI in Collection settings; a daily cap limits cost. |
| Licensed directory dataset | Your licence with the provider, recorded per source | Not built as a fetcher; reserved for a file you are licensed to use. |
| Manual entry | Collected by staff from the gym | |

Not used, on purpose: Google Maps and Google Business Profile scraping, any CAPTCHA or anti-bot bypass, unsolicited WhatsApp or robocalls,
OTP "verification" of other people's numbers.

## AI help

Uses the project's existing `ANTHROPIC_API_KEY` (and `AI_MODEL` if set). Two uses, both off until **Collection settings → AI help** is ticked, and both capped by "Claude calls per day" (India day; the job pauses until after midnight when it is spent):

1. **Finding a gym's own website** (source "AI website finder"): Claude web search, strict JSON answer, address checked against a refuse list, then the site is read by the normal website reader, only if its text mentions the gym.
2. **Choosing between a page's numbers**: when a page prints several, Claude is shown each number with the text around it and returns *indexes* to keep (front desk kept; franchise, careers, app lines dropped). It can only pick from numbers the page printed; a failed or odd answer keeps them all.

The model never supplies a number. Every number still has to be extracted from a real page's text by the phone parser. Not run live: no `ANTHROPIC_API_KEY` is available in the development sandbox, so these calls were tested with a faked model only; the first live run should be a small job (a few gyms) while watching Sources → Claude today.

## Using it

Jobs are created by a Super Admin (`createJob`), advanced by the worker, and survive restarts: each state is a step; a step records the same
observations once, so running it twice is harmless; a job whose worker died is picked up when its lease (6 minutes) runs out; a busy server is
retried after a back-off, and only when attempts run out is that state marked failed, so a retry redoes only the failed states.

Check a source from any computer with internet, without touching the database:

```
npx tsx scripts/gym-intel-live-check.ts IN-JH
```

Environment variables: none new. It uses `DATABASE_URL`, `DIRECT_URL` and `CRON_SECRET`, which FITRON already needs. The scheduled worker
needs the existing `CRON_SECRET` repository secret.

Install and launch: the same as the rest of FITRON (`npm install`, `npx prisma migrate deploy`, `npm run dev`). New packages: `libphonenumber-js`, `exceljs`.

## Live test (24 Oct 2026)

`scripts/gym-intel-live-check.ts` was run for Jharkhand from a Vercel Sandbox (the development sandbox itself has no access to these hosts).
OpenStreetMap's Overpass answered HTTP 200 in 28 s with **19** named gyms; **2** published a phone number (1 mobile, 1 landline), both valid in
format; none were invalid or unnamed. That is what the source holds for that state, not a defect: **few gyms in OpenStreetMap carry a phone
number**, so the number of phones this source can ever give is a small fraction of the gyms it lists. More numbers come from gym websites
(read only when allowed), licensed datasets and staff entry. No count of "all gyms in India" is promised.

Not yet run live: the AI help (needs the production key), the full database path on the production site (it needs the migration applied there, a Super Admin signed in, the source
switched on, and the worker running), the website reader against real sites, and the India Post PIN directory import.

## Tests

`src/lib/domain/gym-intel/*.test.ts` (phone parsing and status, OpenStreetMap parsing, matching and branches, robots.txt and page reading) and
`src/lib/services/gym-intel/gym-intel.db.test.ts` (database: permissions, import, idempotence, duplicates and merges, job retry/failure/resume,
website reading with robots.txt, promotion and duplicate-lead prevention, verification, exports, coverage and overview). The tests use an
Overpass-format **fixture with invented names and numbers** and a fake network. They show the engine's logic is right; they are not data.

## Known limitations

- CRM leads hold one unique 10-digit **mobile** number. A gym with only a landline or toll-free number is kept in Gym Intelligence and cannot be promoted until a mobile is published.
- Uploads through the website are limited to about 4 MB by the host. Use the live OpenStreetMap collection for whole states.
- PIN-code status is derived from the state-level search, not searched PIN by PIN: a PIN with no gyms is shown as "completed, no results", which never means no gyms exist.
- Overpass can be busy or time out for large states; the job retries, then marks the state failed for a retry.
- Nothing here checks that a number reaches the gym. Verification is a recorded human action.
- Compliance: public visibility is not consent to marketing. Use do-not-contact, and check TRAI/DPDP rules before any outreach campaign.

## Rollback

The migration only adds tables, a sequence and RLS. To roll back after deploying the code that doesn't use them, drop the `Gi*` tables and the
`GiGymSeq` sequence; no existing table is changed (`CrmLead` only gains a back-relation in the schema, not a column). Before any bulk collection, take a database backup.

## Status

Phases 1–3 done: engine, data model, services, exports, worker, tests, and the Super Admin pages (checked in a browser; no accessibility violations in dark, light or phone view). Phase 4 done: bulk promotion, assignment by area with history, sales analytics. Phase 5 (the PIN directory loaded at scale, more sources) is operational: load the directory and switch on more sources.
