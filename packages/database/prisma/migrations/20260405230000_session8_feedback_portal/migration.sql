-- Session 8: Client Feedback node + portal
-- Extends WorkflowRun with feedback re-entry tracking
-- Extends Feedback with rich portal feedback fields

ALTER TABLE "workflow_runs"
  ADD COLUMN "trigger_type"           TEXT,
  ADD COLUMN "reentry_from_node_id"   TEXT,
  ADD COLUMN "parent_run_id"          TEXT;

ALTER TABLE "feedbacks"
  ADD COLUMN "star_rating"        INTEGER,
  ADD COLUMN "tone_feedback"      TEXT,
  ADD COLUMN "content_tags"       JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "specific_changes"   JSONB NOT NULL DEFAULT '[]';
