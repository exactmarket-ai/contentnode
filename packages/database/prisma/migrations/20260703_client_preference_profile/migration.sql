-- CreateTable: client_preference_profiles
-- Aggregate editorial style profile for signals where editor identity is unknown.

CREATE TABLE "client_preference_profiles" (
    "id"               TEXT NOT NULL,
    "client_id"        TEXT NOT NULL,
    "agency_id"        TEXT NOT NULL,
    "tone_signals"     JSONB NOT NULL DEFAULT '[]',
    "structure_signals" JSONB NOT NULL DEFAULT '[]',
    "reject_patterns"  JSONB NOT NULL DEFAULT '[]',
    "revision_count"   INTEGER NOT NULL DEFAULT 0,
    "last_signal_at"   TIMESTAMP(3),
    "last_decay_at"    TIMESTAMP(3),
    "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"       TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_preference_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "client_preference_profiles_client_id_key" ON "client_preference_profiles"("client_id");
CREATE INDEX "client_preference_profiles_agency_id_idx" ON "client_preference_profiles"("agency_id");

ALTER TABLE "client_preference_profiles"
    ADD CONSTRAINT "client_preference_profiles_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "client_preference_profiles"
    ADD CONSTRAINT "client_preference_profiles_agency_id_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
