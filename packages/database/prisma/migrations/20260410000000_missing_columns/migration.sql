-- Add columns and tables that were added to schema.prisma but never got a migration

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

ALTER TABLE "workflows"
  ADD COLUMN IF NOT EXISTS "project_name" TEXT,
  ADD COLUMN IF NOT EXISTS "item_name" TEXT,
  ADD COLUMN IF NOT EXISTS "is_template" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "template_category" TEXT,
  ADD COLUMN IF NOT EXISTS "template_description" TEXT;

ALTER TABLE "workflow_runs"
  ADD COLUMN IF NOT EXISTS "batch_id" TEXT,
  ADD COLUMN IF NOT EXISTS "batch_index" INTEGER,
  ADD COLUMN IF NOT EXISTS "review_status" TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS "reviewer_ids" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "content_hash" TEXT;
