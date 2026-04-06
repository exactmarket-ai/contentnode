-- Session 9: Pattern Intelligence Layer
-- Adds seniority to stakeholders + full pattern intelligence fields to insights

-- Stakeholder seniority (used for collective insight weighting)
ALTER TABLE "stakeholders" ADD COLUMN "seniority" TEXT NOT NULL DEFAULT 'member';

-- Insight: status lifecycle
ALTER TABLE "insights" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'pending';

-- Insight: pattern intelligence fields
ALTER TABLE "insights" ADD COLUMN "instance_count"          INTEGER  NOT NULL DEFAULT 1;
ALTER TABLE "insights" ADD COLUMN "stakeholder_ids"         JSONB    NOT NULL DEFAULT '[]';
ALTER TABLE "insights" ADD COLUMN "is_collective"           BOOLEAN  NOT NULL DEFAULT false;
ALTER TABLE "insights" ADD COLUMN "evidence_quotes"         JSONB    NOT NULL DEFAULT '[]';
ALTER TABLE "insights" ADD COLUMN "suggested_node_type"     TEXT;
ALTER TABLE "insights" ADD COLUMN "suggested_config_change" JSONB    NOT NULL DEFAULT '{}';
ALTER TABLE "insights" ADD COLUMN "connected_node_id"       TEXT;
ALTER TABLE "insights" ADD COLUMN "baseline_score"          DOUBLE PRECISION;
ALTER TABLE "insights" ADD COLUMN "post_application_score"  DOUBLE PRECISION;
ALTER TABLE "insights" ADD COLUMN "applied_run_count"       INTEGER  NOT NULL DEFAULT 0;
ALTER TABLE "insights" ADD COLUMN "dismissed_until_run"     INTEGER;
ALTER TABLE "insights" ADD COLUMN "applied_at"              TIMESTAMP(3);

-- Index for canvas sidebar queries (per agency/client filtered by status)
CREATE INDEX "insights_agency_id_client_id_status_idx" ON "insights"("agency_id", "client_id", "status");
