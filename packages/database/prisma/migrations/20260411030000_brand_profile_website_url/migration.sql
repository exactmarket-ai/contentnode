-- Add website_url to client_brand_profiles for website-based brand extraction
ALTER TABLE "client_brand_profiles" ADD COLUMN IF NOT EXISTS "website_url" TEXT;
