CREATE TABLE "company_profiles" (
    "id"                   TEXT NOT NULL,
    "agency_id"            TEXT NOT NULL,
    "client_id"            TEXT NOT NULL,
    "about"                TEXT,
    "founded"              TEXT,
    "headquarters"         TEXT,
    "industry"             TEXT,
    "global_reach"         TEXT,
    "company_category"     TEXT,
    "business_type"        TEXT,
    "employees"            TEXT,
    "core_values"          JSONB NOT NULL DEFAULT '[]',
    "key_achievements"     JSONB NOT NULL DEFAULT '[]',
    "leadership_message"   TEXT,
    "leadership_team"      JSONB NOT NULL DEFAULT '[]',
    "what_they_do"         TEXT,
    "key_offerings"        JSONB NOT NULL DEFAULT '[]',
    "industries_served"    JSONB NOT NULL DEFAULT '[]',
    "partners"             JSONB NOT NULL DEFAULT '[]',
    "milestones"           JSONB NOT NULL DEFAULT '[]',
    "vision_for_future"    TEXT,
    "website"              TEXT,
    "general_inquiries"    TEXT,
    "phone"                TEXT,
    "headquarters_address" TEXT,
    "crawled_from"         TEXT,
    "last_crawled_at"      TIMESTAMP(3),
    "created_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"           TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "company_profiles_client_id_key" ON "company_profiles"("client_id");
CREATE INDEX "company_profiles_agency_id_idx" ON "company_profiles"("agency_id");

ALTER TABLE "company_profiles" ADD CONSTRAINT "company_profiles_agency_id_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "company_profiles" ADD CONSTRAINT "company_profiles_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
