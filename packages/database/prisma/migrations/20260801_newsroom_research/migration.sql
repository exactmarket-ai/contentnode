-- Newsroom Research: vertical colors, notification reference fields, research_jobs table

-- Add color to verticals
ALTER TABLE "verticals" ADD COLUMN IF NOT EXISTS "color" VARCHAR(7);

-- Add reference fields to notifications (for updateable job-linked notifications)
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "reference_id" TEXT;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "reference_status" TEXT;

-- research_jobs: async research job tracking
CREATE TABLE IF NOT EXISTS "research_jobs" (
  "id"             TEXT NOT NULL,
  "agency_id"      TEXT NOT NULL,
  "client_id"      TEXT NOT NULL,
  "vertical_id"    TEXT,
  "user_id"        TEXT,
  "user_input"     TEXT NOT NULL,
  "status"         TEXT NOT NULL DEFAULT 'pending',
  "current_step"   TEXT,
  "recency_window" TEXT NOT NULL DEFAULT '7d',
  "topic_count"    INTEGER,
  "new_topic_ids"  JSONB NOT NULL DEFAULT '[]',
  "error_message"  TEXT,
  "started_at"     TIMESTAMP(3),
  "completed_at"   TIMESTAMP(3),
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "research_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "research_jobs_agency_client_idx" ON "research_jobs"("agency_id", "client_id");
CREATE INDEX IF NOT EXISTS "research_jobs_status_idx"         ON "research_jobs"("status");

DO $$ BEGIN
  ALTER TABLE "research_jobs" ADD CONSTRAINT "research_jobs_agency_id_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "research_jobs" ADD CONSTRAINT "research_jobs_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "research_jobs" ADD CONSTRAINT "research_jobs_vertical_id_fkey"
    FOREIGN KEY ("vertical_id") REFERENCES "verticals"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
