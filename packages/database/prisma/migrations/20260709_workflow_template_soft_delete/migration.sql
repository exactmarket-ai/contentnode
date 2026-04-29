-- Add soft-delete and creator tracking to workflows (for org template management)
ALTER TABLE "workflows" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ;
ALTER TABLE "workflows" ADD COLUMN IF NOT EXISTS "template_created_by" TEXT;

-- Index for efficient template listing (only non-deleted templates)
CREATE INDEX IF NOT EXISTS "workflows_is_template_deleted_at_idx" ON "workflows"("agency_id", "is_template", "deleted_at");
