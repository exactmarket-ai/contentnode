-- CreateTable
CREATE TABLE "prospect_assessments" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT,
    "industry" TEXT,
    "status" TEXT NOT NULL DEFAULT 'not_started',
    "scores" JSONB,
    "findings" JSONB,
    "notes" TEXT,
    "total_score" DOUBLE PRECISION,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prospect_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "prospect_assessments_agency_id_idx" ON "prospect_assessments"("agency_id");

-- AddForeignKey
ALTER TABLE "prospect_assessments" ADD CONSTRAINT "prospect_assessments_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
