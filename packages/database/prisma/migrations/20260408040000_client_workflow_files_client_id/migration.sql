-- Add clientId to ClientWorkflowFiles for proper per-client file isolation
ALTER TABLE "client_workflow_files"
  ADD COLUMN IF NOT EXISTS "client_id" TEXT NOT NULL DEFAULT '';

-- Replace the old (workflow_id, node_id) unique constraint with (client_id, workflow_id, node_id)
ALTER TABLE "client_workflow_files"
  DROP CONSTRAINT IF EXISTS "client_workflow_files_workflow_id_node_id_key";

ALTER TABLE "client_workflow_files"
  ADD CONSTRAINT "client_workflow_files_client_id_workflow_id_node_id_key"
  UNIQUE ("client_id", "workflow_id", "node_id");
