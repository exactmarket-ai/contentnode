-- Content Library: add publish_status and word_count to content_pack_run_items

ALTER TABLE content_pack_run_items
  ADD COLUMN IF NOT EXISTS publish_status text NOT NULL DEFAULT 'draft'
    CHECK (publish_status IN ('draft', 'approved', 'archived')),
  ADD COLUMN IF NOT EXISTS word_count integer;

-- Back-fill word_count for already-completed items
UPDATE content_pack_run_items
SET word_count = array_length(string_to_array(trim(regexp_replace(content, '\s+', ' ', 'g')), ' '), 1)
WHERE content IS NOT NULL AND word_count IS NULL;

-- Index for fast status + client filtering through the run join
CREATE INDEX IF NOT EXISTS idx_cpri_publish_status ON content_pack_run_items (publish_status);
