-- Create client_gtm_assessments table
CREATE TABLE IF NOT EXISTS "client_gtm_assessments" (
  "id"         TEXT NOT NULL,
  "agency_id"  TEXT NOT NULL,
  "client_id"  TEXT NOT NULL,
  "data"       JSONB NOT NULL DEFAULT '{}',
  "updated_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "client_gtm_assessments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "client_gtm_assessments_client_id_key" ON "client_gtm_assessments"("client_id");
CREATE INDEX IF NOT EXISTS "client_gtm_assessments_agency_id_idx" ON "client_gtm_assessments"("agency_id");

ALTER TABLE "client_gtm_assessments"
  ADD CONSTRAINT "client_gtm_assessments_agency_id_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "client_gtm_assessments"
  ADD CONSTRAINT "client_gtm_assessments_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
