CREATE TABLE "integrations" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "access_token" TEXT NOT NULL,
  "refresh_token" TEXT,
  "expires_at" TIMESTAMP(3),
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "integrations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "integrations_agency_id_provider_key" ON "integrations"("agency_id", "provider");

ALTER TABLE "integrations" ADD CONSTRAINT "integrations_agency_id_fkey"
  FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
