-- AlterTable: Client — add Google Drive root folder field
ALTER TABLE "clients" ADD COLUMN "google_drive_folder_id" TEXT;

-- AlterTable: Workflow — add Google Drive project folder field
ALTER TABLE "workflows" ADD COLUMN "google_drive_project_folder_id" TEXT;

-- AlterTable: WorkflowRun — add Google Drive delivery fields
ALTER TABLE "workflow_runs" ADD COLUMN "delivery_google_drive_file_id" TEXT;
ALTER TABLE "workflow_runs" ADD COLUMN "delivered_google_drive_folder_id" TEXT;

-- CreateTable: GoogleDriveFileTracking
CREATE TABLE "google_drive_file_trackings" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "stakeholder_id" TEXT,
    "drive_file_id" TEXT NOT NULL,
    "drive_webhook_channel_id" TEXT,
    "drive_webhook_resource_id" TEXT,
    "channel_expiry" TIMESTAMP(3),
    "drive_folder_id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "original_text_key" TEXT,
    "monday_item_id" TEXT,
    "revision_count" INTEGER NOT NULL DEFAULT 0,
    "last_version_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "google_drive_file_trackings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "google_drive_file_trackings_drive_file_id_key" ON "google_drive_file_trackings"("drive_file_id");
CREATE INDEX "google_drive_file_trackings_agency_id_idx" ON "google_drive_file_trackings"("agency_id");
CREATE INDEX "google_drive_file_trackings_client_id_idx" ON "google_drive_file_trackings"("client_id");
CREATE INDEX "google_drive_file_trackings_run_id_idx" ON "google_drive_file_trackings"("run_id");

-- AddForeignKey
ALTER TABLE "google_drive_file_trackings" ADD CONSTRAINT "google_drive_file_trackings_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "google_drive_file_trackings" ADD CONSTRAINT "google_drive_file_trackings_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "google_drive_file_trackings" ADD CONSTRAINT "google_drive_file_trackings_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "workflow_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "google_drive_file_trackings" ADD CONSTRAINT "google_drive_file_trackings_stakeholder_id_fkey" FOREIGN KEY ("stakeholder_id") REFERENCES "stakeholders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
