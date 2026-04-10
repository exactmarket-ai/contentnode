-- Add output_decisions column to feedbacks table if missing
ALTER TABLE "feedbacks"
  ADD COLUMN IF NOT EXISTS "output_decisions" JSONB NOT NULL DEFAULT '{}';
