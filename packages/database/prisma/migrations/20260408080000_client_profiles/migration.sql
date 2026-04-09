-- CreateTable: client_profiles
CREATE TABLE "client_profiles" (
    "id"                           TEXT NOT NULL,
    "agency_id"                    TEXT NOT NULL,
    "client_id"                    TEXT NOT NULL,
    "brand_tone"                   TEXT,
    "formality"                    TEXT,
    "pov"                          TEXT,
    "signature_phrases"            JSONB NOT NULL DEFAULT '[]',
    "avoid_phrases"                JSONB NOT NULL DEFAULT '[]',
    "primary_buyer"                JSONB NOT NULL DEFAULT '{}',
    "secondary_buyer"              JSONB NOT NULL DEFAULT '{}',
    "buyer_motivations"            JSONB NOT NULL DEFAULT '[]',
    "buyer_fears"                  JSONB NOT NULL DEFAULT '[]',
    "visual_style"                 TEXT,
    "color_temperature"            TEXT,
    "photography_vs_illustration"  TEXT,
    "approved_visual_themes"       JSONB NOT NULL DEFAULT '[]',
    "avoid_visual"                 JSONB NOT NULL DEFAULT '[]',
    "current_positioning"          TEXT,
    "campaign_themes_approved"     JSONB NOT NULL DEFAULT '[]',
    "manual_overrides"             JSONB NOT NULL DEFAULT '[]',
    "confidence_map"               JSONB NOT NULL DEFAULT '{}',
    "crawled_from"                 TEXT,
    "last_crawled_at"              TIMESTAMP(3),
    "created_at"                   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"                   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "client_profiles_client_id_key" ON "client_profiles"("client_id");
CREATE INDEX "client_profiles_agency_id_idx" ON "client_profiles"("agency_id");

-- AddForeignKey
ALTER TABLE "client_profiles" ADD CONSTRAINT "client_profiles_agency_id_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "client_profiles" ADD CONSTRAINT "client_profiles_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
