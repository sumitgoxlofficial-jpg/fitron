# FITRON

One product for India's fitness market, live at **fitron.in**, in three parts that share one login system and one database:

1. **Website** (fitron.in): the landing page with pricing, free-trial sign-up, contact form and policies.
2. **FITRON AI Trainer**: an AI personal trainer for members, from ₹299 a month. Personalised workout plans, Indian meal plans by city, diet and budget, a 24/7 AI coach, habits, progress and weekly reviews.
3. **FITRON Gym Accounting**: gym management and GST accounting for gym owners, from ₹999 a month. Members, plans and renewals, GST invoices, payments, expenses and P&L, assets, purchases, POS, classes, leads, attendance, WhatsApp reminders, UPI Autopay, door devices and the Fitron AI assistant. Multi-branch.

They work together: a gym on FITRON gives its members the AI Trainer under its own brand, sees their training next to their dues, and earns 70% of members' AI Trainer subscriptions through the Gym Partnership.

The AI Trainer's design is the browser demo in `prototype/ai-trainer/` (serve the folder and open `index.html`). The app serves it, wired to the real backend, at `/trainer` from `public/trainer/`; the demo's unreachable admin console, landing page and preview controls are not in that copy.

## What's here

- **The app** (repo root): Next.js (App Router) + TypeScript + Tailwind, Postgres via Prisma. The Gym Accounting console was built from `prototype/HANDOFF.md`.
  - `prisma/schema.prisma`: core schema (tenancy, staff and roles, members, plans, memberships, invoices, payments, expenses, audit log, month locks, settings, sequences).
  - `src/lib/domain/`: business rules with unit tests (invoice totals and GST, computed invoice status, membership status, date maths).
- **The website** (fitron.in): `/` is the static landing page in `public/site` (from the design export; update it with `python3 scripts/import-site.py "FITRON Website.html"`, then `node scripts/optimise-site-images.mjs` for the WebP screenshots. Our own edits on top of the design (wording that must match the product, structured data, the phone fixes) are in `scripts/site_patches.py`, which the import applies last; `python3 scripts/site_patches.py` applies them to the page in place). `/signup`, `/contact`, `/privacy`, `/terms` and `/refund` are in `src/app/(site)`. Trial requests and messages are saved in the `Enquiry` table and emailed to `ENQUIRY_TO` (tickets raised in Settings › Help & support go to `SUPPORT_TO`). Prices live in `src/lib/domain/pricing.ts`; a test checks them against the page. The three parts open each other's sign-in (`src/lib/domain/site-links.ts`): "Log in" on the home page opens `/signin`, which sends gym owners and staff to `/login` and members to `/trainer`; each "Start free trial" opens its own product's sign-in with the plan picked (Gym Accounting on the `/login` Create account tab, where the plan and monthly or yearly billing can be changed; AI Trainer in the member app); and `/login` and `/trainer` link to each other. A Google account with no gym login but an AI Trainer account goes to the AI Trainer.
- **`prototype/`**: the Gym Accounting browser prototype, and the AI Trainer demo in `prototype/ai-trainer/`. Serve the folder (`npx serve prototype`) and open `Fitron Gym.dc.html`. Data lives in localStorage; WhatsApp and UPI Autopay are simulated.
  - `prototype/HANDOFF.md`: the production build spec.
  - `prototype/connector/`: WhatsApp linked-device and Razorpay UPI Autopay service.

## Develop

```bash
npm install            # also generates the Prisma client
cp .env.example .env   # point DATABASE_URL at a Postgres database (or run `npx prisma dev` for a local one)
npm run db:migrate     # create tables
npm run db:seed        # demo gym: sign in as sumit@demo.fitron.in / fitron-demo
npm run dev            # http://localhost:3000 (landing page; the console is at /login)
```

Checks: `npm run lint`, `npm run typecheck`, `npm test` (database tests run when `DATABASE_URL` is set), `npm run build`.

### End-to-end tests

`e2e/` holds browser tests (Playwright) that use the real app the way people do: sign up, sign in with two-step codes, sell a membership and read the GST invoice, open every console page on a desktop and a phone, check what each plan opens, and check the security headers and the Content-Security-Policy (the suite runs the server with `CSP_MODE=enforce`, so a page that needs something the policy forbids fails here). Each test makes its own gym, so tests do not depend on each other or on what an earlier run left in the database.

```bash
export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/fitron_test   # a database with the migrations applied (`npx prisma migrate deploy`)
npm run build
npx playwright install chromium    # once
npm run e2e                        # starts `next start` on port 3100 itself (E2E_PORT to change it)
npx playwright test sale.spec.ts   # one file;  add --ui to watch the browser
```

It tests the production build, so run `npm run build` again after changing the app. A server already running on the port is reused when not in CI, which is quicker but can be an old build. CI runs the same after the unit tests and keeps the report (traces and screenshots of failures) as a download on the run when something fails. The list of console pages is read from `src/app/(app)`, so a new page is covered without editing the tests.

## Go live

To run Fitron for real on a free Oracle Cloud server (app, database, HTTPS, daily jobs and nightly backups in one command), follow [deploy/README.md](deploy/README.md).

To keep the database (and, if you want, member files) in Supabase instead of on that server, see step 11 of the same guide. To host on Vercel, with Supabase and GitHub-run timed jobs, see [deploy/VERCEL.md](deploy/VERCEL.md).

To get the site found by Google and Bing, see [deploy/SEO.md](deploy/SEO.md): what is built in, and the steps only the owner can take.

## Set up a real gym (by hand)

```bash
npx prisma migrate deploy
npm run setup -- --gym "Power Haus Gym" --branch "City Centre" --name "Owner Name" \
  --email owner@example.com --phone 9876543210 --password 'a-long-password'
```

This creates the gym, its first branch, the default roles and the Super Admin account. Everything else (staff, plans, members) is added in the app.

## What works so far

- Sign-in with Argon2id passwords, server-side sessions, 30-minute idle sign-out, login rate limit.
- Two-step sign-in for staff (My profile › Two-step sign-in): a code from an authenticator app after the password or Google, with ten one-use recovery codes. A Super Admin can turn it off for someone who lost their phone (Staff). The secrets are encrypted with `BIOMETRIC_KEY`.
- Roles and permissions (Super Admin, Admin, Accountant, Receptionist, Trainer), enforced on every page and action. Trainers see only their assigned members.
- Branch switcher; every query is limited to the branches a user may see.
- Members: search and filters, add, edit, suspend, soft delete, profile with computed status and dues. Phone numbers are unique among active members.
- Plans: create, edit (applies to new sales only), deactivate, delete only if never sold.
- Staff: add, edit, reset password, deactivate (signs them out).
- My profile (avatar menu, top right): edit your name and mobile, upload a photo, change your password (signs out your other devices), see your recent activity.
- Every change is written to the audit log.
- Financial records are kept by the database itself: invoices, payments, expenses, purchases, assets and the like cannot be deleted, and the audit log cannot be changed, by a bug or by a query typed into a SQL prompt. Only Go live › Clear demo data (on a demo gym) and Backup › Restore from file may remove them (`src/lib/services/db-guard.ts`).
- Exercise form videos: the FITRON team pastes one YouTube (or .mp4) link per exercise on `/fitron-admin/trainer/content`; the AI Trainer plays it on the exercise card and in full screen instead of the demo's placeholder.
- FITRON team console for the AI Trainer (`/fitron-admin/trainer`, FITRON_ADMIN_EMAILS): members by state with search and CSV, every payment with its UTR and decision, and each partner gym's monthly payout.
- AI Trainer push reminders: with VAPID keys set, members who enable notifications get workout, water, meal and sleep nudges on their phone even with the app closed, plus trial-ending, renewal-due and rejected-payment notices; `deploy/scheduler.sh` calls `/api/jobs/trainer` hourly.
- AI Trainer set logging: each exercise card logs weight × reps for today; sets are kept per day, and Progress shows each lift from its first session to its best.
- Monthly profit and loss by email: on the 1st (the daily job runs at 06:30 India time), every active Super Admin of a gym with Accounting gets last month's revenue, expenses and net result, with the statement attached as an Excel file. It needs the server's email (SMTP) and is switched off per gym in Settings › Reminders. A failed send is reported in the app and retried on the 2nd and 3rd; each month goes out once (`src/lib/services/pl-email.ts`).
- Backup restore test: each Sunday at 02:30 India time (`/api/jobs/weekly`, called by `deploy/scheduler.sh`) the newest backup of every gym is read from storage, checked against its checksum and restored for real inside a transaction that is always rolled back (`testRestore` in `src/lib/services/backup.ts`). Nothing changes; it shows in Settings › Backup, and a failure emails the Super Admins and raises a notice. The restore and the test share one function, and the test ends by throwing before anything is recorded.
- Plans open sections: a gym's FITRON plan (Starter, Professional, Enterprise, from the landing page's cards) decides which sections of the console work. Starter has members, renewals, invoices, payments, receivables, expenses, basic reports, plans, settings, import and the audit log; Professional adds accounting, WhatsApp, staff, attendance, classes, leads, POS, UPI autopay, Fitron AI, workouts & diet, the Gym Partnership, biometric doors and the accounting reports; Enterprise adds branch comparison and custom role permissions. Locked sections stay in the sidebar with a lock and lead to Settings › Plan & billing; pages and their actions redirect there too (`src/lib/domain/features.ts`). Gyms set up by hand (no trial) get everything.
- Member check-in from the front-desk QR poster: Attendance › QR shows a poster whose QR opens `/c/<gym>/<branch id>`, a public page where a member types their mobile number and is checked in at that branch under the gym's entry rules, with no sign-in. It answers as little as it can: the member is welcomed by first name, and every refusal (not a member of this branch, expired, frozen, suspended, dues, outside hours, or a plan without Attendance) is the same "ask at the front desk". It is limited to 5 tries per 10 minutes per number and 60 per 10 minutes per address (a gym's Wi-Fi is one address), and kept out of search results (`src/lib/services/self-checkin.ts`). Anyone who knows a member's number can check that member in, which is the cost of a poster with no app.
- FITRON billing by Razorpay, or by UPI QR. With Fitron's Razorpay keys set (`FITRON_RAZORPAY_*`, see `.env.example` and [deploy/README.md](deploy/README.md) step 10), Gym Accounting plans, Gym Partnership plans, extra branches (monthly) and AI Trainer plans are Razorpay Subscriptions that renew themselves; the 14 live plan ids are in `src/lib/domain/razorpay-plans.ts`, and a test keeps their amounts equal to the price list. Yearly partner plans and yearly extra branches, and the one-time add-ons (setup, branding and so on), are single Razorpay payments. Listed prices include GST: the invoice splits it out. Without the keys, gyms and AI Trainer members pay FITRON by UPI QR and type the UTR, and the FITRON team confirms it at `/fitron-admin` (a rejection is written to the gym's audit log). A live server refuses to start a payment when neither `FITRON_RAZORPAY_KEY_ID` nor `FITRON_UPI_ID` is set, so no gym can mark its own plan paid.
- Gym Partnership: Settings makes the gym's trainer code; members type it into the AI Trainer (or open `/trainer?gym=CODE`) to link. Their record at the gym is matched by email or phone, their training shows on their member profile, and the Gym Partnership page lists linked members and the gym's 70% share of each month's AI Trainer payments.

Money is stored as integer paise. Invoice and membership status are computed, never stored.
