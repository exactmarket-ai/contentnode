-- User avatar: store as base64 data URL (same pattern as client logos)
ALTER TABLE "users" ADD COLUMN "avatar_storage_key" TEXT;
