-- Add sources field to company_profiles and client_profiles
ALTER TABLE "company_profiles" ADD COLUMN "sources" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "client_profiles"  ADD COLUMN "sources" JSONB NOT NULL DEFAULT '[]';
