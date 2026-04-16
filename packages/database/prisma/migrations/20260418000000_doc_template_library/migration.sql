-- Document Template Library
-- Stores uploaded Word templates and their AI-suggested variable placements

CREATE TABLE IF NOT EXISTS "doc_templates" (
  "id"             TEXT PRIMARY KEY,
  "agency_id"      TEXT NOT NULL REFERENCES "agencies"("id") ON DELETE CASCADE,
  "name"           TEXT NOT NULL,
  "doc_type"       TEXT NOT NULL DEFAULT 'gtm',
  "original_key"   TEXT NOT NULL,
  "processed_key"  TEXT,
  "html_preview"   TEXT,
  "suggestions"    JSONB NOT NULL DEFAULT '[]',
  "confirmed_vars" JSONB NOT NULL DEFAULT '[]',
  "status"         TEXT NOT NULL DEFAULT 'pending',
  "error_message"  TEXT,
  "size_bytes"     INTEGER NOT NULL DEFAULT 0,
  "created_by"     TEXT,
  "created_at"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "doc_templates_agency_id_idx" ON "doc_templates"("agency_id");

-- Assignments map a template to a scope (client / vertical / doc type / agency default)
CREATE TABLE IF NOT EXISTS "doc_template_assignments" (
  "id"            TEXT PRIMARY KEY,
  "agency_id"     TEXT NOT NULL REFERENCES "agencies"("id") ON DELETE CASCADE,
  "template_id"   TEXT NOT NULL REFERENCES "doc_templates"("id") ON DELETE CASCADE,
  "client_id"     TEXT,
  "vertical_id"   TEXT,
  "doc_type"      TEXT,
  "agency_default" BOOLEAN NOT NULL DEFAULT false,
  "created_at"    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "doc_template_assignments_agency_id_idx"   ON "doc_template_assignments"("agency_id");
CREATE INDEX IF NOT EXISTS "doc_template_assignments_template_id_idx" ON "doc_template_assignments"("template_id");
