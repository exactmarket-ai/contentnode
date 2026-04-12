-- Add edited_content column to workflow_runs for storing polished/edited deliverable content
ALTER TABLE "workflow_runs" ADD COLUMN "edited_content" JSONB;
