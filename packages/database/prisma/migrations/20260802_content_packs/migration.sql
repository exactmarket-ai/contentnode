-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 20260802_content_packs
-- Adds ContentPack, ContentPackItem, ContentPackRun, ContentPackRunItem tables.
-- Also extends Vertical, LeadershipMember, and Client with pack + integration fields.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────
-- 1. Extend Vertical with voice/tone + integration fields
-- ─────────────────────────────────────────────
ALTER TABLE "verticals"
  ADD COLUMN IF NOT EXISTS "target_audience"          TEXT,
  ADD COLUMN IF NOT EXISTS "tone_descriptors"          TEXT[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "key_messages"              TEXT[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "voice_avoid_phrases"       TEXT[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "default_content_pack_id"   TEXT,
  ADD COLUMN IF NOT EXISTS "monday_board_id"           TEXT,
  ADD COLUMN IF NOT EXISTS "monday_column_mapping"     JSONB,
  ADD COLUMN IF NOT EXISTS "box_folder_id"             TEXT;

-- ─────────────────────────────────────────────
-- 2. Extend LeadershipMember with pack + integration fields
-- ─────────────────────────────────────────────
ALTER TABLE "leadership_members"
  ADD COLUMN IF NOT EXISTS "default_content_pack_id"   TEXT,
  ADD COLUMN IF NOT EXISTS "monday_board_id"           TEXT,
  ADD COLUMN IF NOT EXISTS "monday_column_mapping"     JSONB,
  ADD COLUMN IF NOT EXISTS "box_folder_id"             TEXT;

-- ─────────────────────────────────────────────
-- 3. Extend Client with content-specific pack + integration fields
--    (client already has monday_board_id / box_folder_id for Workflow; these are content-specific)
-- ─────────────────────────────────────────────
ALTER TABLE "clients"
  ADD COLUMN IF NOT EXISTS "default_content_pack_id"          TEXT,
  ADD COLUMN IF NOT EXISTS "content_monday_board_id"          TEXT,
  ADD COLUMN IF NOT EXISTS "content_monday_column_mapping"    JSONB,
  ADD COLUMN IF NOT EXISTS "content_box_folder_id"            TEXT;

-- ─────────────────────────────────────────────
-- 4. Create ContentPack table
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "content_packs" (
  "id"          TEXT        NOT NULL,
  "agency_id"   TEXT        NOT NULL,
  "client_id"   TEXT        NOT NULL,
  "name"        TEXT        NOT NULL,
  "description" TEXT,
  "is_default"  BOOLEAN     NOT NULL DEFAULT false,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "content_packs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "content_packs_agency_id_idx" ON "content_packs"("agency_id");
CREATE INDEX IF NOT EXISTS "content_packs_client_id_idx" ON "content_packs"("client_id");

DO $$ BEGIN
  ALTER TABLE "content_packs" ADD CONSTRAINT "content_packs_agency_id_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "content_packs" ADD CONSTRAINT "content_packs_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- FK from Vertical.default_content_pack_id → content_packs (SetNull on delete)
DO $$ BEGIN
  ALTER TABLE "verticals" ADD CONSTRAINT "verticals_default_content_pack_id_fkey"
    FOREIGN KEY ("default_content_pack_id") REFERENCES "content_packs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- FK from LeadershipMember.default_content_pack_id → content_packs (SetNull on delete)
DO $$ BEGIN
  ALTER TABLE "leadership_members" ADD CONSTRAINT "leadership_members_default_content_pack_id_fkey"
    FOREIGN KEY ("default_content_pack_id") REFERENCES "content_packs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- FK from Client.default_content_pack_id → content_packs (SetNull on delete)
DO $$ BEGIN
  ALTER TABLE "clients" ADD CONSTRAINT "clients_default_content_pack_id_fkey"
    FOREIGN KEY ("default_content_pack_id") REFERENCES "content_packs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────────
-- 5. Create ContentPackItem table
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "content_pack_items" (
  "id"                 TEXT        NOT NULL,
  "content_pack_id"    TEXT        NOT NULL,
  "prompt_template_id" TEXT        NOT NULL,
  "order"              INTEGER     NOT NULL DEFAULT 0,
  "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "content_pack_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "content_pack_items_content_pack_id_idx"    ON "content_pack_items"("content_pack_id");
CREATE INDEX IF NOT EXISTS "content_pack_items_prompt_template_id_idx" ON "content_pack_items"("prompt_template_id");

DO $$ BEGIN
  ALTER TABLE "content_pack_items" ADD CONSTRAINT "content_pack_items_content_pack_id_fkey"
    FOREIGN KEY ("content_pack_id") REFERENCES "content_packs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "content_pack_items" ADD CONSTRAINT "content_pack_items_prompt_template_id_fkey"
    FOREIGN KEY ("prompt_template_id") REFERENCES "prompt_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────────
-- 6. Create ContentPackRun table
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "content_pack_runs" (
  "id"                TEXT        NOT NULL,
  "agency_id"         TEXT        NOT NULL,
  "client_id"         TEXT        NOT NULL,
  "topic_id"          TEXT,
  "topic_title"       TEXT        NOT NULL,
  "topic_summary"     TEXT,
  "target_type"       TEXT        NOT NULL,   -- 'member' | 'vertical' | 'company'
  "target_id"         TEXT,
  "target_name"       TEXT        NOT NULL,
  "pack_ids"          JSONB       NOT NULL DEFAULT '[]',
  "pack_names"        JSONB       NOT NULL DEFAULT '[]',
  "status"            TEXT        NOT NULL DEFAULT 'pending',      -- pending | running | completed | failed
  "review_status"     TEXT        NOT NULL DEFAULT 'none',         -- none | pending | approved | closed
  "assignee_id"       TEXT,
  "monday_item_id"    TEXT,
  "monday_board_id"   TEXT,
  "box_run_folder_id" TEXT,
  "error_message"     TEXT,
  "started_at"        TIMESTAMP(3),
  "completed_at"      TIMESTAMP(3),
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "content_pack_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "content_pack_runs_agency_id_idx" ON "content_pack_runs"("agency_id");
CREATE INDEX IF NOT EXISTS "content_pack_runs_client_id_idx" ON "content_pack_runs"("client_id");
CREATE INDEX IF NOT EXISTS "content_pack_runs_status_idx"    ON "content_pack_runs"("status");

DO $$ BEGIN
  ALTER TABLE "content_pack_runs" ADD CONSTRAINT "content_pack_runs_agency_id_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "content_pack_runs" ADD CONSTRAINT "content_pack_runs_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────────
-- 7. Create ContentPackRunItem table
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "content_pack_run_items" (
  "id"                  TEXT        NOT NULL,
  "run_id"              TEXT        NOT NULL,
  "prompt_template_id"  TEXT        NOT NULL,
  "prompt_name"         TEXT        NOT NULL,
  "status"              TEXT        NOT NULL DEFAULT 'pending',   -- pending | running | completed | failed
  "content"             TEXT,
  "error_message"       TEXT,
  "monday_sub_item_id"  TEXT,
  "box_file_id"         TEXT,
  "completed_at"        TIMESTAMP(3),
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "content_pack_run_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "content_pack_run_items_run_id_idx" ON "content_pack_run_items"("run_id");

DO $$ BEGIN
  ALTER TABLE "content_pack_run_items" ADD CONSTRAINT "content_pack_run_items_run_id_fkey"
    FOREIGN KEY ("run_id") REFERENCES "content_pack_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "content_pack_run_items" ADD CONSTRAINT "content_pack_run_items_prompt_template_id_fkey"
    FOREIGN KEY ("prompt_template_id") REFERENCES "prompt_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
