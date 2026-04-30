-- Add primaryBriefId to client_frameworks
ALTER TABLE "client_frameworks" ADD COLUMN "primary_brief_id" TEXT;

-- Create client_briefs table
CREATE TABLE "client_briefs" (
  "id"                TEXT NOT NULL,
  "agency_id"         TEXT NOT NULL,
  "client_id"         TEXT NOT NULL,
  "name"              TEXT NOT NULL,
  "type"              TEXT NOT NULL DEFAULT 'company',
  "status"            TEXT NOT NULL DEFAULT 'draft',
  "source"            TEXT NOT NULL DEFAULT 'pasted',
  "content"           TEXT,
  "extracted_data"    JSONB,
  "raw_input"         TEXT,
  "storage_key"       TEXT,
  "filename"          TEXT,
  "vertical_ids"      TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "extraction_status" TEXT NOT NULL DEFAULT 'none',
  "error_message"     TEXT,
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMP(3) NOT NULL,

  CONSTRAINT "client_briefs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "client_briefs_agency_id_client_id_idx" ON "client_briefs"("agency_id", "client_id");

ALTER TABLE "client_briefs" ADD CONSTRAINT "client_briefs_agency_id_fkey"
  FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "client_briefs" ADD CONSTRAINT "client_briefs_client_id_fkey"
  FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
