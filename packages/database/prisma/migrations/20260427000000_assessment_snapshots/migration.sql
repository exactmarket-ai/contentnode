CREATE TABLE "assessment_snapshots" (
  "id"            TEXT NOT NULL,
  "agency_id"     TEXT NOT NULL,
  "assessment_id" TEXT NOT NULL,
  "source"        TEXT NOT NULL DEFAULT 'full',
  "findings"      JSONB,
  "scores"        JSONB,
  "total_score"   DOUBLE PRECISION,
  "pages_scraped" INTEGER,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "assessment_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "assessment_snapshots_agency_id_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE,
  CONSTRAINT "assessment_snapshots_assessment_id_fkey"
    FOREIGN KEY ("assessment_id") REFERENCES "prospect_assessments"("id") ON DELETE CASCADE
);

CREATE INDEX "assessment_snapshots_assessment_id_idx" ON "assessment_snapshots"("assessment_id");
CREATE INDEX "assessment_snapshots_agency_id_idx" ON "assessment_snapshots"("agency_id");
