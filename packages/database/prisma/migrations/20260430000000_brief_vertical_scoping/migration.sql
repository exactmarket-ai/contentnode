-- Add sharedAcrossVerticals flag to ClientBrief.
-- Briefs default to vertical-scoped (false). Only briefs explicitly marked
-- shared appear in all verticals under a client.
ALTER TABLE "client_briefs"
  ADD COLUMN IF NOT EXISTS "shared_across_verticals" BOOLEAN NOT NULL DEFAULT false;
