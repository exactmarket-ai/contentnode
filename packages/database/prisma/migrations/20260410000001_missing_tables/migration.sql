-- Create tables that were added to schema.prisma but never got a migration

CREATE TABLE IF NOT EXISTS "client_workflow_files" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "client_id" TEXT NOT NULL DEFAULT '',
  "workflow_id" TEXT NOT NULL,
  "node_id" TEXT NOT NULL,
  "files" JSONB NOT NULL DEFAULT '{}',
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "client_workflow_files_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "client_workflow_files_client_id_workflow_id_node_id_key" ON "client_workflow_files"("client_id", "workflow_id", "node_id");
CREATE INDEX IF NOT EXISTS "client_workflow_files_agency_id_idx" ON "client_workflow_files"("agency_id");
CREATE INDEX IF NOT EXISTS "client_workflow_files_workflow_id_idx" ON "client_workflow_files"("workflow_id");
