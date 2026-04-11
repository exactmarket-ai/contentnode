-- Add Claude interpretation fields to brand attachments
ALTER TABLE "client_brand_attachments"
  ADD COLUMN "summary" TEXT,
  ADD COLUMN "summary_status" TEXT NOT NULL DEFAULT 'pending';

-- Existing ready attachments skip the summary pipeline; mark them ready with no summary
-- (user can click Edit to fill in manually, or re-upload to get an auto-summary)
UPDATE "client_brand_attachments"
SET "summary_status" = 'ready'
WHERE "extraction_status" = 'ready';
