-- Extend ClientBrainAttachment for unified brain
ALTER TABLE "client_brain_attachments"
  ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'client',
  ADD COLUMN IF NOT EXISTS "vertical_id" TEXT,
  ADD COLUMN IF NOT EXISTS "campaign_id" TEXT,
  ADD COLUMN IF NOT EXISTS "campaign_scoped_only" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "uploaded_by_user_id" TEXT,
  ADD COLUMN IF NOT EXISTS "upload_method" TEXT NOT NULL DEFAULT 'file';

CREATE INDEX IF NOT EXISTS "client_brain_attachments_source_idx" ON "client_brain_attachments"("source");

-- Add campaignScopedOnly to CampaignBrainAttachment
ALTER TABLE "campaign_brain_attachments"
  ADD COLUMN IF NOT EXISTS "campaign_scoped_only" BOOLEAN NOT NULL DEFAULT false;
