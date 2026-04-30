-- Add sectionStatus to client_frameworks
ALTER TABLE "client_frameworks" ADD COLUMN IF NOT EXISTS "section_status" JSONB NOT NULL DEFAULT '{}';

-- ClientFrameworkResearchRun — versioned research runs
CREATE TABLE IF NOT EXISTS "client_framework_research_runs" (
  "id"              TEXT NOT NULL PRIMARY KEY,
  "agency_id"       TEXT NOT NULL,
  "client_id"       TEXT NOT NULL,
  "vertical_id"     TEXT NOT NULL,
  "status"          TEXT NOT NULL DEFAULT 'pending',
  "research_mode"   TEXT NOT NULL DEFAULT 'established',
  "section_results" JSONB,
  "sources"         JSONB NOT NULL DEFAULT '[]',
  "error_message"   TEXT,
  "merged_from_ids" TEXT[] NOT NULL DEFAULT '{}',
  "researched_at"   TIMESTAMPTZ,
  "created_at"      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "client_framework_research_runs_client_id_vertical_id_idx"
  ON "client_framework_research_runs"("client_id", "vertical_id");
CREATE INDEX IF NOT EXISTS "client_framework_research_runs_agency_id_idx"
  ON "client_framework_research_runs"("agency_id");

-- ClientFrameworkUploadedGtm — client-supplied GTM + conflict analysis
CREATE TABLE IF NOT EXISTS "client_framework_uploaded_gtms" (
  "id"                  TEXT NOT NULL PRIMARY KEY,
  "agency_id"           TEXT NOT NULL,
  "client_id"           TEXT NOT NULL,
  "vertical_id"         TEXT NOT NULL,
  "storage_key"         TEXT NOT NULL,
  "filename"            TEXT NOT NULL,
  "status"              TEXT NOT NULL DEFAULT 'processing',
  "extracted_sections"  JSONB,
  "conflict_log"        JSONB,
  "error_message"       TEXT,
  "uploaded_at"         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "processed_at"        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS "client_framework_uploaded_gtms_client_id_vertical_id_idx"
  ON "client_framework_uploaded_gtms"("client_id", "vertical_id");
CREATE INDEX IF NOT EXISTS "client_framework_uploaded_gtms_agency_id_idx"
  ON "client_framework_uploaded_gtms"("agency_id");
