-- Agency-level prompt template propagation
-- Adds 5 new fields to prompt_templates, plus guards for client_id and created_by
-- which are in the schema but may have been added outside migrations.

ALTER TABLE "prompt_templates"
  ADD COLUMN IF NOT EXISTS "client_id"          TEXT,
  ADD COLUMN IF NOT EXISTS "created_by"         TEXT,
  ADD COLUMN IF NOT EXISTS "agency_level"       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "visible_to_clients" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "propagated_at"      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "is_hidden"          BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "agency_template_id" TEXT;

-- FK for client_id (safe if it already exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'prompt_templates'
      AND constraint_name = 'prompt_templates_client_id_fkey'
  ) THEN
    ALTER TABLE "prompt_templates"
      ADD CONSTRAINT "prompt_templates_client_id_fkey"
        FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "prompt_templates_client_id_idx"          ON "prompt_templates"("client_id");
CREATE INDEX IF NOT EXISTS "prompt_templates_agency_level_idx"       ON "prompt_templates"("agency_level");
CREATE INDEX IF NOT EXISTS "prompt_templates_agency_template_id_idx" ON "prompt_templates"("agency_template_id");
