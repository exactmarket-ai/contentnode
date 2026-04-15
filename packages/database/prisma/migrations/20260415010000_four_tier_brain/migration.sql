-- Four-Tier Brain Architecture
-- Adds AgencyBrainAttachment, VerticalBrainAttachment, ClientVerticalBrainAttachment
-- Adds brainContext to Agency and Vertical
-- Adds verticalId to Workflow (which vertical context to pull at run time)

-- ── Agency Brain ──────────────────────────────────────────────────────────────

ALTER TABLE "agencies"
  ADD COLUMN IF NOT EXISTS "brain_context" TEXT;

CREATE TABLE IF NOT EXISTS "agency_brain_attachments" (
  "id"               TEXT NOT NULL,
  "agency_id"        TEXT NOT NULL,
  "filename"         TEXT NOT NULL,
  "storage_key"      TEXT,
  "source_url"       TEXT,
  "mime_type"        TEXT NOT NULL DEFAULT '',
  "size_bytes"       INTEGER NOT NULL DEFAULT 0,
  "extraction_status" TEXT NOT NULL DEFAULT 'pending',
  "extracted_text"   TEXT,
  "summary_status"   TEXT NOT NULL DEFAULT 'pending',
  "summary"          TEXT,
  "uploaded_by_user_id" TEXT,
  "upload_method"    TEXT NOT NULL DEFAULT 'file',
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "agency_brain_attachments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "agency_brain_attachments_agency_id_idx"
  ON "agency_brain_attachments"("agency_id");

ALTER TABLE "agency_brain_attachments"
  ADD CONSTRAINT "agency_brain_attachments_agency_id_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Vertical Brain ────────────────────────────────────────────────────────────

ALTER TABLE "verticals"
  ADD COLUMN IF NOT EXISTS "brain_context" TEXT;

CREATE TABLE IF NOT EXISTS "vertical_brain_attachments" (
  "id"               TEXT NOT NULL,
  "agency_id"        TEXT NOT NULL,
  "vertical_id"      TEXT NOT NULL,
  "filename"         TEXT NOT NULL,
  "storage_key"      TEXT,
  "source_url"       TEXT,
  "mime_type"        TEXT NOT NULL DEFAULT '',
  "size_bytes"       INTEGER NOT NULL DEFAULT 0,
  "extraction_status" TEXT NOT NULL DEFAULT 'pending',
  "extracted_text"   TEXT,
  "summary_status"   TEXT NOT NULL DEFAULT 'pending',
  "summary"          TEXT,
  "uploaded_by_user_id" TEXT,
  "upload_method"    TEXT NOT NULL DEFAULT 'file',
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "vertical_brain_attachments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "vertical_brain_attachments_agency_id_idx"
  ON "vertical_brain_attachments"("agency_id");

CREATE INDEX IF NOT EXISTS "vertical_brain_attachments_vertical_id_idx"
  ON "vertical_brain_attachments"("vertical_id");

ALTER TABLE "vertical_brain_attachments"
  ADD CONSTRAINT "vertical_brain_attachments_agency_id_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "vertical_brain_attachments"
  ADD CONSTRAINT "vertical_brain_attachments_vertical_id_fkey"
    FOREIGN KEY ("vertical_id") REFERENCES "verticals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Client × Vertical Brain ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "client_vertical_brain_attachments" (
  "id"               TEXT NOT NULL,
  "agency_id"        TEXT NOT NULL,
  "client_id"        TEXT NOT NULL,
  "vertical_id"      TEXT NOT NULL,
  "filename"         TEXT NOT NULL,
  "storage_key"      TEXT,
  "source_url"       TEXT,
  "mime_type"        TEXT NOT NULL DEFAULT '',
  "size_bytes"       INTEGER NOT NULL DEFAULT 0,
  "extraction_status" TEXT NOT NULL DEFAULT 'pending',
  "extracted_text"   TEXT,
  "summary_status"   TEXT NOT NULL DEFAULT 'pending',
  "summary"          TEXT,
  "uploaded_by_user_id" TEXT,
  "upload_method"    TEXT NOT NULL DEFAULT 'file',
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "client_vertical_brain_attachments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "client_vertical_brain_attachments_agency_id_idx"
  ON "client_vertical_brain_attachments"("agency_id");

CREATE INDEX IF NOT EXISTS "client_vertical_brain_attachments_client_id_idx"
  ON "client_vertical_brain_attachments"("client_id");

CREATE INDEX IF NOT EXISTS "client_vertical_brain_attachments_client_vertical_idx"
  ON "client_vertical_brain_attachments"("client_id", "vertical_id");

ALTER TABLE "client_vertical_brain_attachments"
  ADD CONSTRAINT "client_vertical_brain_attachments_agency_id_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "client_vertical_brain_attachments"
  ADD CONSTRAINT "client_vertical_brain_attachments_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "client_vertical_brain_attachments"
  ADD CONSTRAINT "client_vertical_brain_attachments_vertical_id_fkey"
    FOREIGN KEY ("vertical_id") REFERENCES "verticals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Workflow: vertical context ────────────────────────────────────────────────
-- Which vertical this workflow operates in — drives tier 2 + tier 4 context assembly

ALTER TABLE "workflows"
  ADD COLUMN IF NOT EXISTS "vertical_id" TEXT;

ALTER TABLE "workflows"
  ADD CONSTRAINT "workflows_vertical_id_fkey"
    FOREIGN KEY ("vertical_id") REFERENCES "verticals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "workflows_vertical_id_idx"
  ON "workflows"("vertical_id");
