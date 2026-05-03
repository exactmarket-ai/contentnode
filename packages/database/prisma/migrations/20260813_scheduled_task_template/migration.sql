ALTER TABLE "scheduled_tasks" ADD COLUMN IF NOT EXISTS "summary" TEXT;

CREATE TABLE IF NOT EXISTS "scheduled_task_templates" (
  "id"             TEXT        NOT NULL,
  "agency_id"      TEXT        NOT NULL,
  "name"           TEXT        NOT NULL,
  "summary"        TEXT,
  "type"           TEXT        NOT NULL,
  "frequency"      TEXT        NOT NULL DEFAULT 'weekly',
  "config"         JSONB       NOT NULL DEFAULT '{}',
  "created_by_id"  TEXT,
  "created_at"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "scheduled_task_templates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "scheduled_task_templates_agency_id_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE,
  CONSTRAINT "scheduled_task_templates_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "scheduled_task_templates_agency_id_idx"
  ON "scheduled_task_templates"("agency_id");
