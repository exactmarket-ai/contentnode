-- Add brain_context to clients
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "brain_context" TEXT;

-- Create client_brain_attachments table
CREATE TABLE IF NOT EXISTS "client_brain_attachments" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
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

    CONSTRAINT "client_brain_attachments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "client_brain_attachments_client_id_idx" ON "client_brain_attachments"("client_id");
CREATE INDEX IF NOT EXISTS "client_brain_attachments_agency_id_idx" ON "client_brain_attachments"("agency_id");

ALTER TABLE "client_brain_attachments" ADD CONSTRAINT "client_brain_attachments_client_id_fkey"
  FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
