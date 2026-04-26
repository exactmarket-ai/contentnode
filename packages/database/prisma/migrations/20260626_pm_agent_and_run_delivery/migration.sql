-- Add delivery lifecycle fields to workflow_runs
ALTER TABLE "workflow_runs"
  ADD COLUMN "delivered_at"        TIMESTAMPTZ,
  ADD COLUMN "delivery_box_file_id" TEXT,
  ADD COLUMN "is_archived"         BOOLEAN NOT NULL DEFAULT false;

-- PM Agent Memory — persistent learned patterns
CREATE TABLE "pm_agent_memory" (
  "id"             TEXT NOT NULL,
  "agency_id"      TEXT NOT NULL,
  "category"       TEXT NOT NULL,
  "key"            TEXT NOT NULL,
  "value"          JSONB NOT NULL,
  "confidence"     DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  "observed_count" INTEGER NOT NULL DEFAULT 1,
  "question_asked" TEXT,
  "user_answer"    TEXT,
  "workflow_id"    TEXT,
  "user_id"        TEXT,
  "client_id"      TEXT,
  "created_at"     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pm_agent_memory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pm_agent_memory_agency_id_category_key_key"
  ON "pm_agent_memory"("agency_id", "category", "key");
CREATE INDEX "pm_agent_memory_agency_id_idx"       ON "pm_agent_memory"("agency_id");
CREATE INDEX "pm_agent_memory_agency_category_idx" ON "pm_agent_memory"("agency_id", "category");
CREATE INDEX "pm_agent_memory_agency_workflow_idx" ON "pm_agent_memory"("agency_id", "workflow_id");

ALTER TABLE "pm_agent_memory"
  ADD CONSTRAINT "pm_agent_memory_agency_id_fkey"
  FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE;

-- PM Agent Notifications — questions/observations surfaced to humans
CREATE TABLE "pm_agent_notifications" (
  "id"             TEXT NOT NULL,
  "agency_id"      TEXT NOT NULL,
  "type"           TEXT NOT NULL DEFAULT 'question',
  "pattern_key"    TEXT NOT NULL,
  "title"          TEXT NOT NULL,
  "body"           TEXT NOT NULL,
  "context"        JSONB NOT NULL DEFAULT '{}',
  "actions"        JSONB NOT NULL DEFAULT '[]',
  "status"         TEXT NOT NULL DEFAULT 'pending',
  "answered_at"    TIMESTAMPTZ,
  "answered_by"    TEXT,
  "chosen_action"  TEXT,
  "always_apply"   BOOLEAN NOT NULL DEFAULT false,
  "workflow_run_id" TEXT,
  "workflow_id"    TEXT,
  "created_at"     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pm_agent_notifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "pm_agent_notifications_agency_id_idx"        ON "pm_agent_notifications"("agency_id");
CREATE INDEX "pm_agent_notifications_agency_status_idx"    ON "pm_agent_notifications"("agency_id", "status");
CREATE INDEX "pm_agent_notifications_agency_workflow_idx"  ON "pm_agent_notifications"("agency_id", "workflow_id");

ALTER TABLE "pm_agent_notifications"
  ADD CONSTRAINT "pm_agent_notifications_agency_id_fkey"
  FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE;
