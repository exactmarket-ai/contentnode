CREATE TABLE "agency_credentials" (
  "id"         TEXT NOT NULL,
  "agency_id"  TEXT NOT NULL,
  "provider"   TEXT NOT NULL,
  "key_name"   TEXT NOT NULL,
  "key_value"  TEXT NOT NULL,
  "meta"       JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "agency_credentials_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "agency_credentials_agency_id_provider_key_name_key"
    UNIQUE ("agency_id", "provider", "key_name")
);

ALTER TABLE "agency_credentials"
  ADD CONSTRAINT "agency_credentials_agency_id_fkey"
  FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "agency_credentials_agency_id_idx" ON "agency_credentials"("agency_id");
