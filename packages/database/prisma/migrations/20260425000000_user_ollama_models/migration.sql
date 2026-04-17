-- Move ollama_models from agency-level to per-user
ALTER TABLE "users" ADD COLUMN "ollama_models" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "agency_settings" DROP COLUMN IF EXISTS "ollama_models";
