# FITRON sales CRM

The CRM for FITRON's own sales and marketing team (Gym Accounting SaaS and the Gym Partnership programme). It is not the gym console's front-desk "Leads" page.

- **Open it:** "Employee login" on fitron.in → `/employee-login` → the normal sign-in → `/crm`.
- **Accounts:** employees are ordinary `User` rows in an internal organisation called "FITRON Team" (marked as a demo organisation so FITRON admin's gym and user totals leave it out). Sign-in, sessions, two-step and password reset are the product's own. `CrmStaff` adds the CRM role (`admin`, `marketing`, `manager`, `sales`), employee ID (`FIT-EMP-0001`), manager and monthly target.
- **First Super Admin:** anyone whose email is in `FITRON_ADMIN_EMAILS` becomes a CRM Super Admin the first time they open `/crm`. After that, invite everyone else from **Employees** (an email tells them to set a password with *Forgot password*).
- **Rules:** `src/lib/domain/crm.ts` (roles and the permission matrix, stages, phone normalisation, what a stage change needs, import checks, metric definitions). The rules have no database in them and are unit tested.
- **Enforcement:** every page, action and download starts from `requireCrm()` (`src/lib/auth/crm.ts`) and goes through `src/lib/services/crm-*.ts`, which scope every query to the person's role (own leads for a salesperson; team and unassigned for a manager; everything, masked, for marketing). A lead outside someone's scope is "Access denied" (403) and the attempt is audited. Tests: `src/lib/services/crm.db.test.ts`.
- **Audit:** `CrmAudit` is append-only: a database trigger refuses UPDATE, DELETE and TRUNCATE. Phone numbers and emails are scrubbed from audit text.
- **Revenue** is verified Closed Won deals only. A pending deal is shown apart and never added to it. Cost per lead is shown only when a campaign's spend was entered.
- **Not built (needs an integration):** calling (calls are logged by hand, with no durations), WhatsApp/SMS alerts (notifications are in-app only), Razorpay payment lookup during verification, campaign spend from an ads API.
