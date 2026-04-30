CREATE TABLE "pilot_sessions" (
    "id"            TEXT NOT NULL,
    "agency_id"     TEXT NOT NULL,
    "client_id"     TEXT NOT NULL,
    "vertical_id"   TEXT NOT NULL,
    "messages"      JSONB NOT NULL DEFAULT '[]',
    "message_count" INTEGER NOT NULL DEFAULT 0,
    "status"        TEXT NOT NULL DEFAULT 'active',
    "summary"       JSONB,
    "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "summarized_at" TIMESTAMP(3),

    CONSTRAINT "pilot_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "pilot_sessions_agency_client_vertical_idx"
    ON "pilot_sessions"("agency_id", "client_id", "vertical_id");

CREATE INDEX "pilot_sessions_agency_client_vertical_status_idx"
    ON "pilot_sessions"("agency_id", "client_id", "vertical_id", "status");
