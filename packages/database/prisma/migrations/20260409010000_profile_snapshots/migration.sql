ALTER TABLE "client_profiles" ADD COLUMN "crawled_snapshot" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "company_profiles" ADD COLUMN "crawled_snapshot" JSONB NOT NULL DEFAULT '{}';
