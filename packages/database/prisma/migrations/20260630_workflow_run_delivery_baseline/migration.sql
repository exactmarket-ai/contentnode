-- Box Version Detection: baseline storage fields on WorkflowRun
-- deliveredBoxFolderId: denormalized Box folder ID for version scoring (avoids join through BoxFileTracking)
-- deliveredContentHash: SHA-256 of the exact text delivered to Box, distinct from contentHash (source hash)

ALTER TABLE "workflow_runs"
  ADD COLUMN "delivered_box_folder_id" TEXT,
  ADD COLUMN "delivered_content_hash"  TEXT;
