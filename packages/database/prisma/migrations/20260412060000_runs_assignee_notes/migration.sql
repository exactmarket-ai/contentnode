-- Add assignee and internal notes to workflow runs
ALTER TABLE "workflow_runs"
  ADD COLUMN "assignee_id" TEXT REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN "internal_notes" TEXT;

-- Add default assignee to workflows
ALTER TABLE "workflows"
  ADD COLUMN "default_assignee_id" TEXT REFERENCES "users"("id") ON DELETE SET NULL;
