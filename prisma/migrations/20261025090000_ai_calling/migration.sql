-- CreateTable
CREATE TABLE "AcSetting" (
    "id" TEXT NOT NULL,
    "data" JSONB NOT NULL,

    CONSTRAINT "AcSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcCampaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "filter" JSONB NOT NULL,
    "maxCalls" INTEGER NOT NULL,
    "concurrency" INTEGER NOT NULL DEFAULT 1,
    "hoursFrom" INTEGER NOT NULL DEFAULT 600,
    "hoursTo" INTEGER NOT NULL DEFAULT 1080,
    "offer" JSONB NOT NULL,
    "testMode" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMPTZ,
    "startedAt" TIMESTAMPTZ,
    "endedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "AcCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcCall" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT,
    "leadId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "conversationId" TEXT,
    "sipCallId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "test" BOOLEAN NOT NULL DEFAULT false,
    "dialedAt" TIMESTAMPTZ,
    "endedAt" TIMESTAMPTZ,
    "durationSec" INTEGER,
    "disposition" TEXT,
    "summary" TEXT,
    "transcript" JSONB,
    "transcriptExpiresAt" TIMESTAMPTZ,
    "costPaise" INTEGER,
    "error" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "AcCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcDemo" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "callId" TEXT,
    "slotAt" TIMESTAMPTZ NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'BOOKED',
    "note" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AcDemo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcConsent" (
    "phoneNorm" TEXT NOT NULL,
    "basis" TEXT NOT NULL,
    "note" TEXT,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AcConsent_pkey" PRIMARY KEY ("phoneNorm")
);

-- CreateTable
CREATE TABLE "AcSuppression" (
    "phoneNorm" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "callId" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AcSuppression_pkey" PRIMARY KEY ("phoneNorm")
);

-- CreateIndex
CREATE INDEX "AcCampaign_status_idx" ON "AcCampaign"("status");

-- CreateIndex
CREATE UNIQUE INDEX "AcCall_idempotencyKey_key" ON "AcCall"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "AcCall_conversationId_key" ON "AcCall"("conversationId");

-- CreateIndex
CREATE INDEX "AcCall_campaignId_status_idx" ON "AcCall"("campaignId", "status");

-- CreateIndex
CREATE INDEX "AcCall_leadId_createdAt_idx" ON "AcCall"("leadId", "createdAt");

-- CreateIndex
CREATE INDEX "AcCall_status_createdAt_idx" ON "AcCall"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AcDemo_slotAt_idx" ON "AcDemo"("slotAt");

-- CreateIndex
CREATE UNIQUE INDEX "AcDemo_leadId_slotAt_key" ON "AcDemo"("leadId", "slotAt");

-- AddForeignKey
ALTER TABLE "AcCall" ADD CONSTRAINT "AcCall_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "AcCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Every table has row-level security on, like the rest of the database (src/lib/rls.db.test.ts).
ALTER TABLE "AcSetting" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AcCampaign" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AcCall" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AcDemo" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AcConsent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AcSuppression" ENABLE ROW LEVEL SECURITY;

-- Rollback (nothing else refers to these tables):
--   DROP TABLE "AcCall", "AcCampaign", "AcDemo", "AcConsent", "AcSuppression", "AcSetting";
