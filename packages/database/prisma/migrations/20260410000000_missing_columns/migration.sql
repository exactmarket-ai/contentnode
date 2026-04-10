-- Add columns that were added to schema.prisma but never got a migration

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
