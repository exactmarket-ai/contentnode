-- CreateTable: programs
CREATE TABLE "programs" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "scheduled_task_id" TEXT,
    "content_config" JSONB NOT NULL DEFAULT '{}',
    "auto_publish" BOOLEAN NOT NULL DEFAULT false,
    "pilot_context" JSONB,
    "setup_complete" BOOLEAN NOT NULL DEFAULT false,
    "last_run_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "programs_pkey" PRIMARY KEY ("id")
);

-- AlterTable: add program_id to workflow_runs
ALTER TABLE "workflow_runs" ADD COLUMN "program_id" TEXT;

-- CreateIndex
CREATE INDEX "programs_agency_id_idx" ON "programs"("agency_id");
CREATE INDEX "programs_client_id_idx" ON "programs"("client_id");
CREATE INDEX "workflow_runs_program_id_idx" ON "workflow_runs"("program_id");

-- AddForeignKey
ALTER TABLE "programs" ADD CONSTRAINT "programs_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "programs" ADD CONSTRAINT "programs_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "programs" ADD CONSTRAINT "programs_scheduled_task_id_fkey" FOREIGN KEY ("scheduled_task_id") REFERENCES "scheduled_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
