-- AlterTable: add context field to campaigns
ALTER TABLE "campaigns" ADD COLUMN "context" TEXT;

-- CreateTable: campaign brain attachments
CREATE TABLE "campaign_brain_attachments" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "storage_key" TEXT,
    "source_url" TEXT,
    "mime_type" TEXT NOT NULL DEFAULT '',
    "size_bytes" INTEGER NOT NULL DEFAULT 0,
    "extraction_status" TEXT NOT NULL DEFAULT 'pending',
    "extracted_text" TEXT,
    "summary_status" TEXT NOT NULL DEFAULT 'pending',
    "summary" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_brain_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "campaign_brain_attachments_campaign_id_idx" ON "campaign_brain_attachments"("campaign_id");
CREATE INDEX "campaign_brain_attachments_agency_id_idx"   ON "campaign_brain_attachments"("agency_id");

-- AddForeignKey
ALTER TABLE "campaign_brain_attachments" ADD CONSTRAINT "campaign_brain_attachments_campaign_id_fkey"
    FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
