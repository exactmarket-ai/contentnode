CREATE TABLE "divisions" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "client_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "divisions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "jobs" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "division_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "budget_cents" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "workflow_runs" ADD COLUMN "division_id" TEXT;
ALTER TABLE "workflow_runs" ADD COLUMN "job_id" TEXT;
ALTER TABLE "workflow_runs" ADD COLUMN "item_name" TEXT;
ALTER TABLE "workflow_runs" ADD COLUMN "item_version" INTEGER NOT NULL DEFAULT 1;

CREATE INDEX "divisions_agency_id_idx" ON "divisions"("agency_id");
CREATE INDEX "divisions_client_id_idx" ON "divisions"("client_id");
CREATE INDEX "jobs_agency_id_idx" ON "jobs"("agency_id");
CREATE INDEX "jobs_division_id_idx" ON "jobs"("division_id");
CREATE INDEX "workflow_runs_division_id_idx" ON "workflow_runs"("division_id");
CREATE INDEX "workflow_runs_job_id_idx" ON "workflow_runs"("job_id");

ALTER TABLE "divisions" ADD CONSTRAINT "divisions_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "divisions" ADD CONSTRAINT "divisions_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_division_id_fkey" FOREIGN KEY ("division_id") REFERENCES "divisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_division_id_fkey" FOREIGN KEY ("division_id") REFERENCES "divisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
