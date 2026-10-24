-- AlterTable
ALTER TABLE "CrmStaff" ADD COLUMN     "prefs" JSONB;

-- CreateTable
CREATE TABLE "CrmContact" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmSavedView" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmSavedView_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CrmContact_leadId_idx" ON "CrmContact"("leadId");

-- CreateIndex
CREATE INDEX "CrmSavedView_ownerId_idx" ON "CrmSavedView"("ownerId");

-- AddForeignKey
ALTER TABLE "CrmContact" ADD CONSTRAINT "CrmContact_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "CrmLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Like every table: closed to a database API such as Supabase's (src/lib/services/rls.db.test.ts).
ALTER TABLE "CrmContact" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CrmSavedView" ENABLE ROW LEVEL SECURITY;
