-- Humanizer Intelligence: edit signal capture and compiled profiles
-- Step 1: edit_signal_summary on content pack run items
ALTER TABLE content_pack_run_items
  ADD COLUMN IF NOT EXISTS edit_signal_summary text;

-- Step 2: extend humanizer_signals with content-library-approval fields
ALTER TABLE humanizer_signals
  ADD COLUMN IF NOT EXISTS content_type  text,
  ADD COLUMN IF NOT EXISTS assignment_type text;

CREATE INDEX IF NOT EXISTS idx_humanizer_signals_source
  ON humanizer_signals (agency_id, source);

CREATE INDEX IF NOT EXISTS idx_humanizer_signals_content_type
  ON humanizer_signals (agency_id, content_type)
  WHERE content_type IS NOT NULL;

-- Step 3: humanizer_profiles — compiled style intelligence per scope
CREATE TABLE IF NOT EXISTS humanizer_profiles (
  id                  text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  agency_id           text        NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  scope               text        NOT NULL CHECK (scope IN ('agency', 'client', 'content_type')),
  scope_id            text,                       -- clientId or contentType depending on scope
  profile             text,
  signal_count        integer     NOT NULL DEFAULT 0,
  last_synthesis_at   timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  UNIQUE (agency_id, scope, scope_id)
);

CREATE INDEX IF NOT EXISTS idx_humanizer_profiles_agency
  ON humanizer_profiles (agency_id);
