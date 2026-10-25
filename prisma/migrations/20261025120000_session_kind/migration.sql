-- Add kind column to Session: "gym" for Gym Accounting, "crm" for the employee CRM.
-- Existing sessions are gym sessions (the CRM was not in production before this).
ALTER TABLE "Session" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'gym';
