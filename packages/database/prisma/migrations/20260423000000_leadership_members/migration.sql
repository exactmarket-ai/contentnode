-- CreateTable: leadership_members
CREATE TABLE "leadership_members" (
  "id"                TEXT NOT NULL,
  "agency_id"         TEXT NOT NULL,
  "client_id"         TEXT NOT NULL,
  "name"              TEXT NOT NULL,
  "role"              TEXT NOT NULL,
  "linkedin_url"      TEXT,
  "headshot_url"      TEXT,
  "bio"               TEXT,
  "personal_tone"     TEXT,
  "signature_topics"  JSONB NOT NULL DEFAULT '[]',
  "signature_stories" JSONB NOT NULL DEFAULT '[]',
  "avoid_phrases"     JSONB NOT NULL DEFAULT '[]',
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "leadership_members_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "leadership_members_agency_id_idx" ON "leadership_members"("agency_id");
CREATE INDEX "leadership_members_client_id_idx" ON "leadership_members"("client_id");

-- FK → clients
ALTER TABLE "leadership_members"
  ADD CONSTRAINT "leadership_members_client_id_fkey"
  FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- FK → agencies
ALTER TABLE "leadership_members"
  ADD CONSTRAINT "leadership_members_agency_id_fkey"
  FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: agency isolation
ALTER TABLE "leadership_members" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "leadership_members_agency_isolation" ON "leadership_members"
  USING (agency_id = current_setting('app.current_agency_id', true));
