-- Extend prompt_templates with Library fields
-- source:               who created it — 'user' (manual) | 'ai' (generated from Brain) | 'global' (Global Library)
-- brain_snapshot_version: SHA-256 of the Brain context JSON at generation time; null for user/global templates
-- is_stale:            true when the Brain has been updated since this AI template was generated

ALTER TABLE "prompt_templates"
  ADD COLUMN IF NOT EXISTS "source" VARCHAR(10) NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS "brain_snapshot_version" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "is_stale" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "prompt_templates_source_idx" ON "prompt_templates"("source");
