-- Create workflow_schedules table if missing
CREATE TABLE IF NOT EXISTS "workflow_schedules" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "workflow_id" TEXT NOT NULL,
  "name" TEXT,
  "cron_expr" TEXT NOT NULL,
  "timezone" TEXT NOT NULL DEFAULT 'UTC',
  "status" TEXT NOT NULL DEFAULT 'active',
  "next_run_at" TIMESTAMP(3),
  "last_run_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workflow_schedules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "workflow_schedules_agency_id_idx" ON "workflow_schedules"("agency_id");
CREATE INDEX IF NOT EXISTS "workflow_schedules_workflow_id_idx" ON "workflow_schedules"("workflow_id");
CREATE INDEX IF NOT EXISTS "workflow_schedules_status_next_run_at_idx" ON "workflow_schedules"("status", "next_run_at");
