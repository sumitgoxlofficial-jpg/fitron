-- AlterTable
ALTER TABLE "CrmLead" ADD COLUMN     "addons" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "billing" TEXT NOT NULL DEFAULT 'MONTHLY',
ADD COLUMN     "plan" TEXT NOT NULL DEFAULT 'starter',
ADD COLUMN     "verifiedAt" TIMESTAMPTZ;

-- A deal approved before this column existed earned from the day it was last changed.
UPDATE "CrmLead" SET "verifiedAt" = "updatedAt" WHERE "verification" = 'Verified' AND "verifiedAt" IS NULL;
