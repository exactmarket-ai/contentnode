-- Add permissions_override to agencies, clients, users
ALTER TABLE "agencies" ADD COLUMN "permissions_override" JSONB;
ALTER TABLE "clients" ADD COLUMN "permissions_override" JSONB;
ALTER TABLE "users" ADD COLUMN "permissions_override" JSONB;

-- Create usage_events table
CREATE TABLE "usage_events" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" TEXT,
    "user_role" TEXT,
    "client_id" TEXT,
    "agency_id" TEXT NOT NULL,
    "tool_type" TEXT NOT NULL,
    "tool_subtype" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "is_online" BOOLEAN NOT NULL,
    "workflow_id" TEXT,
    "workflow_run_id" TEXT,
    "node_id" TEXT,
    "node_type" TEXT,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "input_characters" INTEGER,
    "output_characters" INTEGER,
    "input_media_count" INTEGER,
    "output_media_count" INTEGER,
    "output_duration_secs" DOUBLE PRECISION,
    "output_resolution" TEXT,
    "estimated_cost_usd" DOUBLE PRECISION,
    "duration_ms" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "error_code" TEXT,
    "error_message" TEXT,
    "permissions_at_time" JSONB,
    "corrects" TEXT,
    CONSTRAINT "usage_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "usage_events_agency_id_idx" ON "usage_events"("agency_id");
CREATE INDEX "usage_events_agency_id_user_id_idx" ON "usage_events"("agency_id", "user_id");
CREATE INDEX "usage_events_agency_id_client_id_idx" ON "usage_events"("agency_id", "client_id");
CREATE INDEX "usage_events_agency_id_workflow_run_id_idx" ON "usage_events"("agency_id", "workflow_run_id");
CREATE INDEX "usage_events_agency_id_tool_type_idx" ON "usage_events"("agency_id", "tool_type");
CREATE INDEX "usage_events_agency_id_timestamp_idx" ON "usage_events"("agency_id", "timestamp");

ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_agency_id_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
