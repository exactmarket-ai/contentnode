-- Brand tables: client_brand_verticals, client_brand_profiles,
-- client_brand_builder, client_brand_attachments

CREATE TABLE IF NOT EXISTS "client_brand_verticals" (
  "id"         TEXT NOT NULL,
  "agency_id"  TEXT NOT NULL,
  "client_id"  TEXT NOT NULL,
  "name"       TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "client_brand_verticals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "client_brand_verticals_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE,
  CONSTRAINT "client_brand_verticals_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "client_brand_verticals_client_id_idx" ON "client_brand_verticals"("client_id");
CREATE INDEX IF NOT EXISTS "client_brand_verticals_agency_id_idx" ON "client_brand_verticals"("agency_id");

-- vertical_id NULL means the "General" brand (applies to all verticals)
CREATE TABLE IF NOT EXISTS "client_brand_profiles" (
  "id"                TEXT NOT NULL,
  "agency_id"         TEXT NOT NULL,
  "client_id"         TEXT NOT NULL,
  "vertical_id"       TEXT,
  "extraction_status" TEXT NOT NULL DEFAULT 'idle',
  "extracted_json"    JSONB,
  "edited_json"       JSONB,
  "source_text"       TEXT,
  "error_message"     TEXT,
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "client_brand_profiles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "client_brand_profiles_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE,
  CONSTRAINT "client_brand_profiles_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE,
  CONSTRAINT "client_brand_profiles_vertical_id_fkey" FOREIGN KEY ("vertical_id") REFERENCES "client_brand_verticals"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "client_brand_profiles_client_id_idx" ON "client_brand_profiles"("client_id");
CREATE INDEX IF NOT EXISTS "client_brand_profiles_agency_id_idx" ON "client_brand_profiles"("agency_id");

CREATE TABLE IF NOT EXISTS "client_brand_builder" (
  "id"          TEXT NOT NULL,
  "agency_id"   TEXT NOT NULL,
  "client_id"   TEXT NOT NULL,
  "vertical_id" TEXT,
  "data_json"   JSONB NOT NULL DEFAULT '{}',
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "client_brand_builder_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "client_brand_builder_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE,
  CONSTRAINT "client_brand_builder_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE,
  CONSTRAINT "client_brand_builder_vertical_id_fkey" FOREIGN KEY ("vertical_id") REFERENCES "client_brand_verticals"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "client_brand_builder_client_id_idx" ON "client_brand_builder"("client_id");
CREATE INDEX IF NOT EXISTS "client_brand_builder_agency_id_idx" ON "client_brand_builder"("agency_id");

CREATE TABLE IF NOT EXISTS "client_brand_attachments" (
  "id"                TEXT NOT NULL,
  "agency_id"         TEXT NOT NULL,
  "client_id"         TEXT NOT NULL,
  "vertical_id"       TEXT,
  "filename"          TEXT NOT NULL,
  "storage_key"       TEXT NOT NULL,
  "mime_type"         TEXT NOT NULL,
  "size_bytes"        INTEGER NOT NULL,
  "extraction_status" TEXT NOT NULL DEFAULT 'pending',
  "extracted_text"    TEXT,
  "error_message"     TEXT,
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "client_brand_attachments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "client_brand_attachments_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE,
  CONSTRAINT "client_brand_attachments_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE,
  CONSTRAINT "client_brand_attachments_vertical_id_fkey" FOREIGN KEY ("vertical_id") REFERENCES "client_brand_verticals"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "client_brand_attachments_client_id_idx" ON "client_brand_attachments"("client_id");
CREATE INDEX IF NOT EXISTS "client_brand_attachments_agency_id_idx" ON "client_brand_attachments"("agency_id");
