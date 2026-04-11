-- GTM Framework tables: client_frameworks, client_framework_attachments, client_framework_research
-- These were in the Prisma schema but never had a migration.

CREATE TABLE IF NOT EXISTS "client_frameworks" (
  "id"          TEXT NOT NULL,
  "agency_id"   TEXT NOT NULL,
  "client_id"   TEXT NOT NULL,
  "vertical_id" TEXT NOT NULL,
  "data"        JSONB NOT NULL DEFAULT '{}',
  "updated_at"  TIMESTAMP(3) NOT NULL,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "client_frameworks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "client_frameworks_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE,
  CONSTRAINT "client_frameworks_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE,
  CONSTRAINT "client_frameworks_vertical_id_fkey" FOREIGN KEY ("vertical_id") REFERENCES "verticals"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "client_frameworks_client_id_vertical_id_key" ON "client_frameworks"("client_id", "vertical_id");
CREATE INDEX IF NOT EXISTS "client_frameworks_agency_id_idx" ON "client_frameworks"("agency_id");

CREATE TABLE IF NOT EXISTS "client_framework_attachments" (
  "id"             TEXT NOT NULL,
  "agency_id"      TEXT NOT NULL,
  "client_id"      TEXT NOT NULL,
  "vertical_id"    TEXT NOT NULL,
  "filename"       TEXT NOT NULL,
  "storage_key"    TEXT NOT NULL,
  "mime_type"      TEXT NOT NULL,
  "size_bytes"     INTEGER NOT NULL,
  "summary_status" TEXT NOT NULL DEFAULT 'pending',
  "extracted_text" TEXT,
  "summary"        TEXT,
  "error_message"  TEXT,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "client_framework_attachments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "client_framework_attachments_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE,
  CONSTRAINT "client_framework_attachments_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE,
  CONSTRAINT "client_framework_attachments_vertical_id_fkey" FOREIGN KEY ("vertical_id") REFERENCES "verticals"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "client_framework_attachments_client_id_vertical_id_idx" ON "client_framework_attachments"("client_id", "vertical_id");
CREATE INDEX IF NOT EXISTS "client_framework_attachments_agency_id_idx" ON "client_framework_attachments"("agency_id");

CREATE TABLE IF NOT EXISTS "client_framework_research" (
  "id"            TEXT NOT NULL,
  "agency_id"     TEXT NOT NULL,
  "client_id"     TEXT NOT NULL,
  "vertical_id"   TEXT NOT NULL,
  "status"        TEXT NOT NULL DEFAULT 'pending',
  "sources"       JSONB NOT NULL DEFAULT '[]',
  "website_url"   TEXT,
  "error_message" TEXT,
  "researched_at" TIMESTAMP(3),
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "client_framework_research_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "client_framework_research_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE,
  CONSTRAINT "client_framework_research_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE,
  CONSTRAINT "client_framework_research_vertical_id_fkey" FOREIGN KEY ("vertical_id") REFERENCES "verticals"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "client_framework_research_client_id_vertical_id_key" ON "client_framework_research"("client_id", "vertical_id");
CREATE INDEX IF NOT EXISTS "client_framework_research_agency_id_idx" ON "client_framework_research"("agency_id");
