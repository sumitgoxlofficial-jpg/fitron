-- CreateTable
CREATE TABLE "CrmStaff" (
    "userId" TEXT NOT NULL,
    "empId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "managerId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "monthlyTarget" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "CrmStaff_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "CrmCampaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "spend" INTEGER,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmLead" (
    "id" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "gymName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "altPhone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "city" TEXT,
    "district" TEXT,
    "state" TEXT,
    "pin" TEXT,
    "campaignId" TEXT,
    "source" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "ownerId" TEXT,
    "createdById" TEXT NOT NULL,
    "assignedAt" TIMESTAMPTZ,
    "stage" TEXT NOT NULL DEFAULT 'New Lead',
    "priority" TEXT NOT NULL DEFAULT 'Medium',
    "estValue" INTEGER NOT NULL DEFAULT 0,
    "lastContactAt" TIMESTAMPTZ,
    "closedById" TEXT,
    "verification" TEXT,
    "verifiedById" TEXT,
    "proofType" TEXT,
    "proofRef" TEXT,
    "closedDate" DATE,
    "lossReason" TEXT,
    "rejectReason" TEXT,
    "demoDone" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "CrmLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmAssignment" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "fromOwner" TEXT,
    "toOwner" TEXT,
    "actorId" TEXT NOT NULL,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmActivity" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "outcome" TEXT,
    "notes" TEXT,
    "objection" TEXT,
    "nextAction" TEXT,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmTask" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "dueAt" TIMESTAMPTZ NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'Medium',
    "done" BOOLEAN NOT NULL DEFAULT false,
    "doneAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmNotification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "leadId" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmAudit" (
    "id" BIGSERIAL NOT NULL,
    "actorId" TEXT NOT NULL,
    "leadId" TEXT,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "meta" JSONB,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CrmStaff_empId_key" ON "CrmStaff"("empId");

-- CreateIndex
CREATE INDEX "CrmStaff_role_idx" ON "CrmStaff"("role");

-- CreateIndex
CREATE INDEX "CrmStaff_managerId_idx" ON "CrmStaff"("managerId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmLead_phone_key" ON "CrmLead"("phone");

-- CreateIndex
CREATE INDEX "CrmLead_ownerId_stage_idx" ON "CrmLead"("ownerId", "stage");

-- CreateIndex
CREATE INDEX "CrmLead_campaignId_idx" ON "CrmLead"("campaignId");

-- CreateIndex
CREATE INDEX "CrmLead_createdAt_idx" ON "CrmLead"("createdAt");

-- CreateIndex
CREATE INDEX "CrmLead_verification_idx" ON "CrmLead"("verification");

-- CreateIndex
CREATE INDEX "CrmAssignment_leadId_idx" ON "CrmAssignment"("leadId");

-- CreateIndex
CREATE INDEX "CrmActivity_leadId_at_idx" ON "CrmActivity"("leadId", "at");

-- CreateIndex
CREATE INDEX "CrmActivity_actorId_at_idx" ON "CrmActivity"("actorId", "at");

-- CreateIndex
CREATE INDEX "CrmTask_ownerId_done_dueAt_idx" ON "CrmTask"("ownerId", "done", "dueAt");

-- CreateIndex
CREATE INDEX "CrmTask_leadId_idx" ON "CrmTask"("leadId");

-- CreateIndex
CREATE INDEX "CrmNotification_userId_read_createdAt_idx" ON "CrmNotification"("userId", "read", "createdAt");

-- CreateIndex
CREATE INDEX "CrmAudit_leadId_at_idx" ON "CrmAudit"("leadId", "at");

-- CreateIndex
CREATE INDEX "CrmAudit_at_idx" ON "CrmAudit"("at");

-- AddForeignKey
ALTER TABLE "CrmStaff" ADD CONSTRAINT "CrmStaff_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmStaff" ADD CONSTRAINT "CrmStaff_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "CrmStaff"("userId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmLead" ADD CONSTRAINT "CrmLead_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "CrmCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmAssignment" ADD CONSTRAINT "CrmAssignment_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "CrmLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmActivity" ADD CONSTRAINT "CrmActivity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "CrmLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmTask" ADD CONSTRAINT "CrmTask_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "CrmLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Lead ids are FL-0001, FL-0002…: a database sequence, so two people adding a lead at once never get the same one.
CREATE SEQUENCE "CrmLeadSeq" START 1001;

-- The audit trail is append-only: nobody, the app included, can change or remove a row.
CREATE FUNCTION crm_audit_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'CrmAudit is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER crm_audit_no_change BEFORE UPDATE OR DELETE ON "CrmAudit" FOR EACH ROW EXECUTE FUNCTION crm_audit_append_only();
CREATE TRIGGER crm_audit_no_truncate BEFORE TRUNCATE ON "CrmAudit" FOR EACH STATEMENT EXECUTE FUNCTION crm_audit_append_only();

-- Like every table: closed to a database API such as Supabase's (src/lib/services/rls.db.test.ts).
ALTER TABLE "CrmStaff" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CrmCampaign" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CrmLead" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CrmAssignment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CrmActivity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CrmTask" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CrmNotification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CrmAudit" ENABLE ROW LEVEL SECURITY;
