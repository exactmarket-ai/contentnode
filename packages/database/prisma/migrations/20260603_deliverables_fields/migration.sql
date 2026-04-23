-- Add deliverables tracking fields to workflow_runs
ALTER TABLE workflow_runs
  ADD COLUMN IF NOT EXISTS priority          VARCHAR,
  ADD COLUMN IF NOT EXISTS status_external   TEXT,
  ADD COLUMN IF NOT EXISTS followup_status   TEXT,
  ADD COLUMN IF NOT EXISTS main_client_name  VARCHAR,
  ADD COLUMN IF NOT EXISTS other_stakeholders TEXT,
  ADD COLUMN IF NOT EXISTS team_design       VARCHAR,
  ADD COLUMN IF NOT EXISTS team_content      VARCHAR,
  ADD COLUMN IF NOT EXISTS team_video        VARCHAR,
  ADD COLUMN IF NOT EXISTS sow_number        VARCHAR,
  ADD COLUMN IF NOT EXISTS budget_ms         DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS main_category     VARCHAR,
  ADD COLUMN IF NOT EXISTS focus             VARCHAR,
  ADD COLUMN IF NOT EXISTS client_folder_box  TEXT,
  ADD COLUMN IF NOT EXISTS client_folder_client TEXT;

-- Index for common search/sort paths
CREATE INDEX IF NOT EXISTS idx_workflow_runs_priority     ON workflow_runs(priority);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_main_category ON workflow_runs(main_category);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_sow_number   ON workflow_runs(sow_number);
