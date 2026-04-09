-- CreateTable: ContentQualityRecord
-- One record per completed workflow run, capturing quality signals for learning.

CREATE TABLE "content_quality_records" (
    "id"                  TEXT NOT NULL,
    "agency_id"           TEXT NOT NULL,
    "workflow_id"         TEXT NOT NULL,
    "client_id"           TEXT,
    "run_id"              TEXT NOT NULL,
    "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "content_type"        TEXT,
    "word_count"          INTEGER,
    "detection_scores"    JSONB NOT NULL DEFAULT '[]',
    "ai_generations"      JSONB NOT NULL DEFAULT '[]',
    "humanizer_runs"      JSONB NOT NULL DEFAULT '[]',
    "stakeholder_rating"  DOUBLE PRECISION,
    "feedback_decision"   TEXT,
    "feedback_count"      INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "content_quality_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "content_quality_records_run_id_key" ON "content_quality_records"("run_id");
CREATE INDEX "content_quality_records_agency_id_idx" ON "content_quality_records"("agency_id");
CREATE INDEX "content_quality_records_agency_workflow_idx" ON "content_quality_records"("agency_id", "workflow_id");
CREATE INDEX "content_quality_records_agency_client_idx" ON "content_quality_records"("agency_id", "client_id");
CREATE INDEX "content_quality_records_created_at_idx" ON "content_quality_records"("created_at");

ALTER TABLE "content_quality_records"
    ADD CONSTRAINT "content_quality_records_run_id_fkey"
    FOREIGN KEY ("run_id") REFERENCES "workflow_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
