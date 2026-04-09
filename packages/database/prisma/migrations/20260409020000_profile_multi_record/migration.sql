-- Allow multiple company profiles per client (research library)
DROP INDEX "company_profiles_client_id_key";
ALTER TABLE "company_profiles" ADD COLUMN "label"  TEXT;
ALTER TABLE "company_profiles" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'active';

-- Allow multiple brand profiles per client (research library)
DROP INDEX "client_profiles_client_id_key";
ALTER TABLE "client_profiles" ADD COLUMN "label"  TEXT;
ALTER TABLE "client_profiles" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'active';
