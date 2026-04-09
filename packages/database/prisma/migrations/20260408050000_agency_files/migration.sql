-- Agency-level file library
CREATE TABLE IF NOT EXISTS "agency_files" (
  "id"            TEXT        NOT NULL DEFAULT gen_random_uuid(),
  "agency_id"     TEXT        NOT NULL,
  "original_name" TEXT        NOT NULL,
  "storage_key"   TEXT        NOT NULL,
  "label"         TEXT,
  "category"      TEXT,
  "size_bytes"    INTEGER     NOT NULL DEFAULT 0,
  "created_at"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "agency_files_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "agency_files_agency_id_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "agency_files_agency_id_idx" ON "agency_files"("agency_id");
