-- Content Newsroom: topic_queue, topic_preference_log, and scheduled_task content_mode

-- Add content_mode to scheduled_tasks (replaces auto_generate boolean)
ALTER TABLE "scheduled_tasks" ADD COLUMN IF NOT EXISTS "content_mode" TEXT NOT NULL DEFAULT 'off';

-- Migrate existing auto_generate values
UPDATE "scheduled_tasks" SET "content_mode" = 'auto_generate' WHERE "auto_generate" = true AND "content_mode" = 'off';

-- topic_queue: one row per candidate topic produced by the evaluator
CREATE TABLE IF NOT EXISTS "topic_queue" (
  "id"                TEXT NOT NULL,
  "agency_id"         TEXT NOT NULL,
  "client_id"         TEXT NOT NULL,
  "vertical_id"       TEXT,
  "scheduled_task_id" TEXT,
  "title"             TEXT NOT NULL,
  "summary"           TEXT NOT NULL,
  "score"             INTEGER NOT NULL DEFAULT 0,
  "score_rationale"   TEXT NOT NULL DEFAULT '',
  "sources"           JSONB NOT NULL DEFAULT '[]',
  "status"            TEXT NOT NULL DEFAULT 'pending',
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewed_at"       TIMESTAMP(3),

  CONSTRAINT "topic_queue_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "topic_queue_agency_client_idx"    ON "topic_queue"("agency_id", "client_id");
CREATE INDEX IF NOT EXISTS "topic_queue_client_vertical_idx"  ON "topic_queue"("client_id", "vertical_id");
CREATE INDEX IF NOT EXISTS "topic_queue_status_idx"           ON "topic_queue"("status");

DO $$ BEGIN
  ALTER TABLE "topic_queue" ADD CONSTRAINT "topic_queue_agency_id_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "topic_queue" ADD CONSTRAINT "topic_queue_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "topic_queue" ADD CONSTRAINT "topic_queue_vertical_id_fkey"
    FOREIGN KEY ("vertical_id") REFERENCES "verticals"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "topic_queue" ADD CONSTRAINT "topic_queue_scheduled_task_id_fkey"
    FOREIGN KEY ("scheduled_task_id") REFERENCES "scheduled_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- topic_preference_log: one row per approve/reject decision
CREATE TABLE IF NOT EXISTS "topic_preference_log" (
  "id"               TEXT NOT NULL,
  "agency_id"        TEXT NOT NULL,
  "client_id"        TEXT NOT NULL,
  "vertical_id"      TEXT,
  "topic_queue_id"   TEXT NOT NULL,
  "decision"         TEXT NOT NULL,
  "title"            TEXT NOT NULL,
  "summary"          TEXT NOT NULL,
  "score"            INTEGER NOT NULL DEFAULT 0,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "topic_preference_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "topic_pref_log_client_vertical_idx" ON "topic_preference_log"("client_id", "vertical_id");
CREATE INDEX IF NOT EXISTS "topic_pref_log_agency_idx"           ON "topic_preference_log"("agency_id");

DO $$ BEGIN
  ALTER TABLE "topic_preference_log" ADD CONSTRAINT "topic_preference_log_agency_id_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "topic_preference_log" ADD CONSTRAINT "topic_preference_log_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "topic_preference_log" ADD CONSTRAINT "topic_preference_log_vertical_id_fkey"
    FOREIGN KEY ("vertical_id") REFERENCES "verticals"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "topic_preference_log" ADD CONSTRAINT "topic_preference_log_topic_queue_id_fkey"
    FOREIGN KEY ("topic_queue_id") REFERENCES "topic_queue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
