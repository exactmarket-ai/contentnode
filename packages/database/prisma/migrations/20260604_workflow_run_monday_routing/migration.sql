-- Add Monday routing fields to workflow_runs
-- Promotes mondayItemId/mondayBoardId from the input JSON blob to first-class
-- columns so the worker can route deliverables back to the right PM item.
ALTER TABLE workflow_runs
  ADD COLUMN IF NOT EXISTS monday_item_id   VARCHAR,
  ADD COLUMN IF NOT EXISTS monday_board_id  VARCHAR;

CREATE INDEX IF NOT EXISTS idx_workflow_runs_monday_item  ON workflow_runs(monday_item_id);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_monday_board ON workflow_runs(monday_board_id);
