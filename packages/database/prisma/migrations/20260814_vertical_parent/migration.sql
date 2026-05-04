ALTER TABLE verticals ADD COLUMN IF NOT EXISTS parent_vertical_id TEXT REFERENCES verticals(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_verticals_parent_vertical_id ON verticals(parent_vertical_id);
