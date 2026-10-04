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

## Go live

To run Fitron for real on a free Oracle Cloud server (app, database, HTTPS, daily jobs and nightly backups in one command), follow [deploy/README.md](deploy/README.md).

## Set up a real gym (by hand)

```bash
npx prisma migrate deploy
npm run setup -- --gym "Power Haus Gym" --branch "City Centre" --name "Owner Name" \
  --email owner@example.com --phone 9876543210 --password 'a-long-password'
```

This creates the gym, its first branch, the default roles and the Super Admin account. Everything else (staff, plans, members) is added in the app.

## What works so far

- Sign-in with Argon2id passwords, server-side sessions, 30-minute idle sign-out, login rate limit.
- Roles and permissions (Super Admin, Admin, Accountant, Receptionist, Trainer), enforced on every page and action. Trainers see only their assigned members.
- Branch switcher; every query is limited to the branches a user may see.
- Members: search and filters, add, edit, suspend, soft delete, profile with computed status and dues. Phone numbers are unique among active members.
- Plans: create, edit (applies to new sales only), deactivate, delete only if never sold.
- Staff: add, edit, reset password, deactivate (signs them out).
- My profile (avatar menu, top right): edit your name and mobile, upload a photo, change your password (signs out your other devices), see your recent activity.
- Every change is written to the audit log.
- Exercise form videos: the FITRON team pastes one YouTube (or .mp4) link per exercise on `/fitron-admin/trainer/content`; the AI Trainer plays it on the exercise card and in full screen instead of the demo's placeholder.
- FITRON team console for the AI Trainer (`/fitron-admin/trainer`, FITRON_ADMIN_EMAILS): members by state with search and CSV, every payment with its UTR and decision, and each partner gym's monthly payout.
- AI Trainer push reminders: with VAPID keys set, members who enable notifications get workout, water, meal and sleep nudges on their phone even with the app closed, plus trial-ending, renewal-due and rejected-payment notices; `deploy/scheduler.sh` calls `/api/jobs/trainer` hourly.
- AI Trainer set logging: each exercise card logs weight × reps for today; sets are kept per day, and Progress shows each lift from its first session to its best.
- Plans open sections: a gym's FITRON plan (Starter, Professional, Enterprise, from the landing page's cards) decides which sections of the console work. Starter has members, renewals, invoices, payments, receivables, expenses, basic reports, plans, settings, import and the audit log; Professional adds accounting, WhatsApp, staff, attendance, classes, leads, POS, UPI autopay, Fitron AI, workouts & diet, the Gym Partnership, biometric doors and the accounting reports; Enterprise adds branch comparison and custom role permissions. Locked sections stay in the sidebar with a lock and lead to Settings › Plan & billing; pages and their actions redirect there too (`src/lib/domain/features.ts`). Gyms set up by hand (no trial) get everything.
- Gym Partnership: Settings makes the gym's trainer code; members type it into the AI Trainer (or open `/trainer?gym=CODE`) to link. Their record at the gym is matched by email or phone, their training shows on their member profile, and the Gym Partnership page lists linked members and the gym's 70% share of each month's AI Trainer payments.

Money is stored as integer paise. Invoice and membership status are computed, never stored.
