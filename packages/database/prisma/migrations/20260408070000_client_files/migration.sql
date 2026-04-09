-- ClientFile — client-scoped library files
CREATE TABLE IF NOT EXISTS "client_files" (
  "id"           TEXT        NOT NULL DEFAULT gen_random_uuid(),
  "agency_id"    TEXT        NOT NULL,
  "client_id"    TEXT        NOT NULL,
  "original_name" TEXT       NOT NULL,
  "storage_key"  TEXT        NOT NULL,
  "label"        TEXT,
  "category"     TEXT,
  "size_bytes"   INTEGER     NOT NULL DEFAULT 0,
  "created_at"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "client_files_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "client_files_agency_id_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE,
  CONSTRAINT "client_files_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "client_files_agency_id_idx" ON "client_files"("agency_id");
CREATE INDEX IF NOT EXISTS "client_files_client_id_idx" ON "client_files"("client_id");
