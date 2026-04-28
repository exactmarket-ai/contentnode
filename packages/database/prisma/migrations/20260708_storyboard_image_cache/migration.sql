-- Add storyboard image cache to kit_sessions
ALTER TABLE "kit_sessions"
  ADD COLUMN IF NOT EXISTS "storyboard_image_cache" JSONB NOT NULL DEFAULT '{}';
