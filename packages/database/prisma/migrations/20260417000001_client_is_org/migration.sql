-- Add isOrgClient flag to clients table
-- Agencies mark their own company as the org client; it becomes the fallback
-- for workflows created without a specific client (prospect/internal work).
ALTER TABLE "clients" ADD COLUMN "is_org_client" BOOLEAN NOT NULL DEFAULT false;

-- Mark "Exact Market" as the org client for the existing agency
UPDATE "clients" SET "is_org_client" = true WHERE "name" = 'Exact Market';
