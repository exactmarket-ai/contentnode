-- Add source_vertical_id to client_brand_verticals so branding can auto-sync
-- with the Structure tab's assigned Vertical records.
ALTER TABLE "client_brand_verticals" ADD COLUMN "source_vertical_id" TEXT;
