-- Reusable prompt/instruction templates
CREATE TABLE IF NOT EXISTS "prompt_templates" (
  "id"          TEXT        NOT NULL DEFAULT gen_random_uuid(),
  "agency_id"   TEXT        NOT NULL,
  "name"        TEXT        NOT NULL,
  "body"        TEXT        NOT NULL,
  "category"    TEXT        NOT NULL DEFAULT 'general',
  "description" TEXT,
  "parent_id"   TEXT,
  "use_count"   INTEGER     NOT NULL DEFAULT 0,
  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "prompt_templates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "prompt_templates_agency_id_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "prompt_templates_agency_id_idx" ON "prompt_templates"("agency_id");
