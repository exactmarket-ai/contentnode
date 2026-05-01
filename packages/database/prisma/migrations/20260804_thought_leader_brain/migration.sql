-- ──────────────────────────────────────────────────────────────────────────────
-- Migration: 20260804_thought_leader_brain
-- Adds ThoughtLeaderBrain + ThoughtLeaderBrainAttachment tables,
-- replaces linkedin_url with social_profiles on leadership_members,
-- and adds original_content to content_pack_run_items for edit signal capture.
-- ──────────────────────────────────────────────────────────────────────────────

-- ── 1. leadership_members: replace linkedin_url with social_profiles ──────────

ALTER TABLE leadership_members
  ADD COLUMN IF NOT EXISTS social_profiles         jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS social_sync_last_ran_at timestamptz;

-- Migrate any existing linkedin_url values into social_profiles
UPDATE leadership_members
SET social_profiles = jsonb_build_array(
  jsonb_build_object(
    'platform',    'linkedin',
    'url',         linkedin_url,
    'syncEnabled', true
  )
)
WHERE linkedin_url IS NOT NULL AND linkedin_url <> '';

ALTER TABLE leadership_members DROP COLUMN IF EXISTS linkedin_url;

-- ── 2. ThoughtLeaderBrain table ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS thought_leader_brains (
  id                   text PRIMARY KEY,
  agency_id            text NOT NULL,
  client_id            text NOT NULL,
  leadership_member_id text NOT NULL,
  context              text,
  last_synthesis_at    timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_tl_brain_member UNIQUE (leadership_member_id),
  CONSTRAINT fk_tl_brain_member FOREIGN KEY (leadership_member_id)
    REFERENCES leadership_members(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tl_brains_agency ON thought_leader_brains (agency_id);
CREATE INDEX IF NOT EXISTS idx_tl_brains_client ON thought_leader_brains (client_id);

-- ── 3. ThoughtLeaderBrainAttachment table ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS thought_leader_brain_attachments (
  id                   text PRIMARY KEY,
  agency_id            text NOT NULL,
  client_id            text NOT NULL,
  leadership_member_id text NOT NULL,
  source               text NOT NULL, -- profile | content_run | edit_signal | social_sync
  content              text NOT NULL,
  metadata             jsonb,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_tlba_member FOREIGN KEY (leadership_member_id)
    REFERENCES leadership_members(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tlba_member ON thought_leader_brain_attachments (leadership_member_id);
CREATE INDEX IF NOT EXISTS idx_tlba_agency  ON thought_leader_brain_attachments (agency_id);

-- ── 4. content_pack_run_items: add original_content for edit signal ───────────

ALTER TABLE content_pack_run_items
  ADD COLUMN IF NOT EXISTS original_content text;
