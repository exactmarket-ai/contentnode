-- Add uploaded_by_user_id to campaign and brand brain attachment tables
ALTER TABLE "campaign_brain_attachments"
  ADD COLUMN IF NOT EXISTS "uploaded_by_user_id" TEXT;

ALTER TABLE "client_brand_attachments"
  ADD COLUMN IF NOT EXISTS "uploaded_by_user_id" TEXT;
