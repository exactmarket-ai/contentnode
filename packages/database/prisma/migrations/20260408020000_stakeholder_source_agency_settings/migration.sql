-- Add lastActiveAt to users
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "last_active_at" TIMESTAMPTZ;

-- Add source + expiresAt to stakeholders
ALTER TABLE "stakeholders"
  ADD COLUMN IF NOT EXISTS "source"     TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS "expires_at" TIMESTAMPTZ;

-- Create agency_settings table
CREATE TABLE IF NOT EXISTS "agency_settings" (
  "id"                        TEXT        NOT NULL DEFAULT gen_random_uuid(),
  "agency_id"                 TEXT        NOT NULL,
  "temp_contact_expiry_days"  INTEGER,
  "created_at"                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"                TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "agency_settings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "agency_settings_agency_id_key" UNIQUE ("agency_id"),
  CONSTRAINT "agency_settings_agency_id_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE
);
