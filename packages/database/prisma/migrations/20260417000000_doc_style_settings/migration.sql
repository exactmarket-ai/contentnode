-- Add DOCX style columns to agency_settings
ALTER TABLE "agency_settings"
  ADD COLUMN IF NOT EXISTS "doc_logo_storage_key" TEXT,
  ADD COLUMN IF NOT EXISTS "doc_primary_color"    TEXT NOT NULL DEFAULT '#1B1F3B',
  ADD COLUMN IF NOT EXISTS "doc_secondary_color"  TEXT NOT NULL DEFAULT '#4A90D9',
  ADD COLUMN IF NOT EXISTS "doc_heading_font"     TEXT NOT NULL DEFAULT 'Calibri',
  ADD COLUMN IF NOT EXISTS "doc_body_font"        TEXT NOT NULL DEFAULT 'Calibri',
  ADD COLUMN IF NOT EXISTS "doc_agency_name"      TEXT,
  ADD COLUMN IF NOT EXISTS "doc_cover_page"           BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "doc_page_numbers"         BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "doc_footer_text"          TEXT,
  ADD COLUMN IF NOT EXISTS "doc_apply_to_gtm"         BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "doc_apply_to_demand_gen"  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "doc_apply_to_branding"    BOOLEAN NOT NULL DEFAULT false;

-- Per-client DOCX style overrides
CREATE TABLE IF NOT EXISTS "client_doc_styles" (
  "id"                TEXT PRIMARY KEY,
  "agency_id"         TEXT NOT NULL REFERENCES "agencies"("id") ON DELETE CASCADE,
  "client_id"         TEXT NOT NULL UNIQUE REFERENCES "clients"("id") ON DELETE CASCADE,
  "logo_storage_key"  TEXT,
  "primary_color"     TEXT,
  "secondary_color"   TEXT,
  "heading_font"      TEXT,
  "body_font"         TEXT,
  "agency_name"       TEXT,
  "cover_page"        BOOLEAN,
  "page_numbers"      BOOLEAN,
  "footer_text"       TEXT,
  "apply_to_gtm"      BOOLEAN,
  "apply_to_demand_gen" BOOLEAN,
  "apply_to_branding" BOOLEAN,
  "created_at"        TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "client_doc_styles_agency_id_idx" ON "client_doc_styles"("agency_id");
