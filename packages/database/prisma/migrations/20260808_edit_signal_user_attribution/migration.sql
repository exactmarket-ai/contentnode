-- Edit signal user attribution
-- Adds userId to signal tables, last_edited_by to run items, userId to leadership members

-- Step 1: userId on leadership_members
ALTER TABLE leadership_members
  ADD COLUMN IF NOT EXISTS user_id text REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_leadership_members_user_id
  ON leadership_members (user_id)
  WHERE user_id IS NOT NULL;

-- Step 2: userId on thought_leader_brain_attachments
ALTER TABLE thought_leader_brain_attachments
  ADD COLUMN IF NOT EXISTS user_id text REFERENCES users(id) ON DELETE SET NULL;

-- Step 3: userId on humanizer_signals
ALTER TABLE humanizer_signals
  ADD COLUMN IF NOT EXISTS user_id text REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_humanizer_signals_user_id
  ON humanizer_signals (user_id)
  WHERE user_id IS NOT NULL;

-- Step 4: last_edited_by_user_id and last_edited_at on content_pack_run_items
ALTER TABLE content_pack_run_items
  ADD COLUMN IF NOT EXISTS last_edited_by_user_id text REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_edited_at timestamptz;

-- Step 5: extend humanizer_profiles scope check to include 'user'
ALTER TABLE humanizer_profiles
  DROP CONSTRAINT IF EXISTS humanizer_profiles_scope_check;

ALTER TABLE humanizer_profiles
  ADD CONSTRAINT humanizer_profiles_scope_check
  CHECK (scope IN ('agency', 'client', 'content_type', 'user'));
