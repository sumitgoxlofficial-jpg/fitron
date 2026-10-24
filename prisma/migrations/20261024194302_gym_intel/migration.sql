-- CreateTable
CREATE TABLE "GiGym" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameNorm" TEXT NOT NULL,
    "phone" TEXT,
    "phoneNorm" TEXT,
    "phoneKind" TEXT,
    "phoneStatus" TEXT NOT NULL DEFAULT 'UNTESTED',
    "association" TEXT NOT NULL DEFAULT 'GENERAL_BUSINESS',
    "reachability" TEXT NOT NULL DEFAULT 'NOT_TESTED',
    "website" TEXT,
    "domain" TEXT,
    "address" TEXT,
    "state" TEXT,
    "district" TEXT,
    "city" TEXT,
    "locality" TEXT,
    "pin" TEXT,
    "lat" DOUBLE PRECISION,
    "lon" DOUBLE PRECISION,
    "category" TEXT NOT NULL DEFAULT 'gym',
    "dupGroup" TEXT,
    "reviewStatus" TEXT NOT NULL DEFAULT 'NEW',
    "promotion" TEXT NOT NULL DEFAULT 'NOT_PROMOTED',
    "leadId" TEXT,
    "firstSeen" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastChecked" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "GiGym_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GiGymSource" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "sourceRecordId" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "originalPhones" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "phonesNorm" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "originalAddress" TEXT,
    "evidence" JSONB,
    "licenseRef" TEXT NOT NULL,
    "jobId" TEXT,
    "collectedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastCheckedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GiGymSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GiJob" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "scope" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "checkpoint" JSONB,
    "leaseUntil" TIMESTAMPTZ,
    "recordsFound" INTEGER NOT NULL DEFAULT 0,
    "phonesFound" INTEGER NOT NULL DEFAULT 0,
    "duplicates" INTEGER NOT NULL DEFAULT 0,
    "errorSummary" TEXT,
    "errors" JSONB,
    "createdById" TEXT NOT NULL,
    "startedAt" TIMESTAMPTZ,
    "completedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "GiJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GiGeo" (
    "id" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "district" TEXT,
    "locality" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "lastJobId" TEXT,
    "gymsFound" INTEGER NOT NULL DEFAULT 0,
    "refSource" TEXT NOT NULL,
    "refUpdated" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkedAt" TIMESTAMPTZ,

    CONSTRAINT "GiGeo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GiSource" (
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB,
    "lastSuccessAt" TIMESTAMPTZ,
    "lastError" TEXT,
    "lastErrorAt" TIMESTAMPTZ,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "recordsFound" INTEGER NOT NULL DEFAULT 0,
    "phonesFound" INTEGER NOT NULL DEFAULT 0,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMPTZ,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "GiSource_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "GiSetting" (
    "id" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "GiSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GiDup" (
    "id" TEXT NOT NULL,
    "aId" TEXT NOT NULL,
    "bId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "reasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GiDup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GiSuppression" (
    "phoneNorm" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "addedById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GiSuppression_pkey" PRIMARY KEY ("phoneNorm")
);

-- CreateIndex
CREATE UNIQUE INDEX "GiGym_leadId_key" ON "GiGym"("leadId");

-- CreateIndex
CREATE INDEX "GiGym_state_district_city_idx" ON "GiGym"("state", "district", "city");

-- CreateIndex
CREATE INDEX "GiGym_pin_idx" ON "GiGym"("pin");

-- CreateIndex
CREATE INDEX "GiGym_phoneNorm_idx" ON "GiGym"("phoneNorm");

-- CreateIndex
CREATE INDEX "GiGym_nameNorm_idx" ON "GiGym"("nameNorm");

-- CreateIndex
CREATE INDEX "GiGym_phoneStatus_idx" ON "GiGym"("phoneStatus");

-- CreateIndex
CREATE INDEX "GiGym_promotion_idx" ON "GiGym"("promotion");

-- CreateIndex
CREATE INDEX "GiGym_domain_idx" ON "GiGym"("domain");

-- CreateIndex
CREATE INDEX "GiGymSource_gymId_idx" ON "GiGymSource"("gymId");

-- CreateIndex
CREATE INDEX "GiGymSource_jobId_idx" ON "GiGymSource"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "GiGymSource_source_sourceRecordId_key" ON "GiGymSource"("source", "sourceRecordId");

-- CreateIndex
CREATE INDEX "GiJob_status_idx" ON "GiJob"("status");

-- CreateIndex
CREATE UNIQUE INDEX "GiGeo_code_key" ON "GiGeo"("code");

-- CreateIndex
CREATE INDEX "GiGeo_level_state_idx" ON "GiGeo"("level", "state");

-- CreateIndex
CREATE INDEX "GiGeo_state_district_idx" ON "GiGeo"("state", "district");

-- CreateIndex
CREATE INDEX "GiDup_status_idx" ON "GiDup"("status");

-- CreateIndex
CREATE UNIQUE INDEX "GiDup_aId_bId_key" ON "GiDup"("aId", "bId");

-- AddForeignKey
ALTER TABLE "GiGym" ADD CONSTRAINT "GiGym_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "CrmLead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiGymSource" ADD CONSTRAINT "GiGymSource_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "GiGym"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiDup" ADD CONSTRAINT "GiDup_aId_fkey" FOREIGN KEY ("aId") REFERENCES "GiGym"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiDup" ADD CONSTRAINT "GiDup_bId_fkey" FOREIGN KEY ("bId") REFERENCES "GiGym"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Gym ids: GG-0000001
CREATE SEQUENCE "GiGymSeq" START 1;

-- Every table has row-level security on, like the rest of the database (src/lib/rls.db.test.ts).
ALTER TABLE "GiGym" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GiGymSource" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GiJob" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GiGeo" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GiSource" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GiSetting" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GiDup" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GiSuppression" ENABLE ROW LEVEL SECURITY;
