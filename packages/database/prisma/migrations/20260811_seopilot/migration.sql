-- seoPILOT migration
-- 1. Extend topic_queue with paa_questions + source_tag
-- 2. Create seo_strategy_sessions
-- 3. Create seo_content_briefs

ALTER TABLE "topic_queue" ADD COLUMN "paa_questions" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "topic_queue" ADD COLUMN "source_tag" TEXT;

CREATE TABLE "seo_strategy_sessions" (
    "id"              TEXT NOT NULL,
    "agency_id"       TEXT NOT NULL,
    "client_id"       TEXT NOT NULL,
    "template_key"    TEXT NOT NULL,
    "status"          TEXT NOT NULL DEFAULT 'in_progress',
    "messages"        JSONB NOT NULL DEFAULT '[]',
    "strategy_output" JSONB,
    "created_by"      TEXT,
    "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seo_strategy_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "seo_content_briefs" (
    "id"                  TEXT NOT NULL,
    "agency_id"           TEXT NOT NULL,
    "client_id"           TEXT NOT NULL,
    "session_id"          TEXT,
    "topic"               TEXT NOT NULL,
    "target_keyword"      TEXT NOT NULL,
    "funnel_stage"        TEXT NOT NULL,
    "urgency"             TEXT NOT NULL,
    "paa_questions"       JSONB DEFAULT '[]',
    "content_format"      TEXT,
    "estimated_impact"    TEXT,
    "brief"               TEXT,
    "pushed_to_newsroom"  BOOLEAN NOT NULL DEFAULT false,
    "newsroom_topic_id"   TEXT,
    "created_at"          TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seo_content_briefs_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "seo_strategy_sessions"
    ADD CONSTRAINT "seo_strategy_sessions_agency_id_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "seo_strategy_sessions"
    ADD CONSTRAINT "seo_strategy_sessions_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "seo_content_briefs"
    ADD CONSTRAINT "seo_content_briefs_agency_id_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "seo_content_briefs"
    ADD CONSTRAINT "seo_content_briefs_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "seo_content_briefs"
    ADD CONSTRAINT "seo_content_briefs_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "seo_strategy_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "seo_strategy_sessions_agency_client_idx" ON "seo_strategy_sessions"("agency_id", "client_id");
CREATE INDEX "seo_content_briefs_agency_client_idx"    ON "seo_content_briefs"("agency_id", "client_id");
