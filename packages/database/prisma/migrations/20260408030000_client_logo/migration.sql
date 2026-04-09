-- Add logo storage key to clients
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "logo_storage_key" TEXT;
