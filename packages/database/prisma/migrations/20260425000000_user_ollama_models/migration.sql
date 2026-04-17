-- Add per-user ollama_models; retain agency_settings.ollama_models column for schema compat
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "ollama_models" JSONB NOT NULL DEFAULT '[]';
