-- Add local_media_services column to users table
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "local_media_services" JSONB NOT NULL DEFAULT '[]';
