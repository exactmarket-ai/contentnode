-- Add status + archivedAt to clients
ALTER TABLE "clients" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'active';
ALTER TABLE "clients" ADD COLUMN "archived_at" TIMESTAMP(3);

-- Add archivedAt to stakeholders
ALTER TABLE "stakeholders" ADD COLUMN "archived_at" TIMESTAMP(3);
