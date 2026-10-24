# FITRON sales CRM

The CRM for FITRON's own sales and marketing team (Gym Accounting SaaS and the Gym Partnership programme), built from the design in "FITRON CRM v2" (the zip) and the handoff README. It is not the gym console's front-desk "Leads" page.

## Getting in

- **Open it:** "Employee login" on fitron.in → `/employee-login` → `/crm`. The team has its **own** sign-in and create-account page (Sign in / Create account tabs, confirm email, forgot and reset password), separate from the gym login.
- **Accounts:** employees are ordinary `User` rows in an internal organisation called "FITRON Team" (marked as a demo organisation so FITRON admin's gym and user totals leave it out). Sessions, password hashing, email codes and links are the product's own. `CrmStaff` adds the CRM role, employee ID (`FIT-EMP-0001`), manager, monthly target, join date, salary, incentive, profile, sealed payout details and the accepted terms.
- **First Super Admin:** anyone whose email is in `FITRON_ADMIN_EMAILS` becomes a CRM Super Admin the first time they open `/crm`. After that, invite people from **Employees**.
- **Create account:** only `@fitron.in` addresses. The address is confirmed by an emailed code or link before the first sign-in (without SMTP, as for gyms, it is trusted at once). An invited employee finishes their invite by creating their account with the invited address; anyone else becomes a Sales Employee and the Super Admins are told.
- **First sign-in:** a new employee can open only their profile until their details, a bank or UPI payout account and the terms (v1.1) are in.

## Roles and rules

- **Rules** are in `src/lib/domain/crm.ts` (roles, the permission matrix, stages, phone normalisation, what a stage change needs, import checks, metrics), `crm-pay.ts` (passwords, profile and payout, terms, commission), `crm-plans.ts` (what is sold) and `crm-dash.ts` (dashboard layouts). They have no database in them and are unit tested.
- **Enforcement:** every page, action and download starts from `requireCrm()` (`src/lib/auth/crm.ts`) and goes through `src/lib/services/crm-*.ts`, which scope every query to the person's role (own leads for a salesperson; team and unassigned for a manager; everything, with phones masked, for marketing). A lead outside someone's scope is "Access denied" (403) and the attempt is audited.
- **Deals:** the plan, billing and add-ons chosen when a lead is closed decide its value (the website's price list, `src/lib/domain/pricing.ts`, is the one source); the browser never sets it. Closed Won waits for approval and is never revenue until approved. A manager can't approve a deal they closed themselves.
- **Commission:** 20% on verified deals for the first 30 days after joining, then a monthly salary plus an incentive (0–5%) at the rate in force the day a deal is approved. Pay day is the 2nd; an employee without a payout account is held.
- **Audit:** `CrmAudit` is append-only (a database trigger refuses UPDATE, DELETE and TRUNCATE). Phone numbers and emails are scrubbed from audit text. Bank and UPI details are sealed (AES-GCM, `sealSecret`) and only ever shown masked.

## Screens

Dashboard (Tiles or Focus, customisable and saved per person), Reports, Leads (filters, saved views, bulk actions, CSV), lead record (stage, owner, call log, tasks, contacts, timeline), Companies, Pipeline, Tasks, Verification, Leaderboard, Activity, Earnings / Commissions, Employees, My ID card (3D, with QR), Price list, Import, Campaigns, Audit log, Roles & permissions, Alerts, Profile. Ctrl K searches pages and leads; `?` lists the shortcuts.

## Not built (needs an integration)

Calling (calls are logged by hand, with no durations), WhatsApp/SMS alerts (alerts are in-app only), Razorpay payment lookup during verification, campaign spend from an ads API.

## Tests

`src/lib/domain/crm*.test.ts` and `src/lib/services/crm*.db.test.ts` (scope per role, masked phones, duplicates, deal rules, import and export, sign-up, invites, lockout, reset, profile gate, sealed payouts, commission and payouts, reports, search, bulk actions).
