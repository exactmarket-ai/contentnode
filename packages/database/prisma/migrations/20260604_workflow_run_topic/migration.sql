-- Add topic field to workflow_runs
-- Captures the run-specific topic/angle entered in the trigger form.
-- Drives the {topic} segment in filenames and provides context to AI nodes.
ALTER TABLE workflow_runs
  ADD COLUMN IF NOT EXISTS topic VARCHAR;
