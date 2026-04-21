CREATE TABLE "framework_revisions" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "client_id" TEXT NOT NULL,
  "vertical_id" TEXT NOT NULL,
  "review_status" TEXT NOT NULL DEFAULT 'draft',
  "revision_type" TEXT NOT NULL DEFAULT 'internal',
  "assignee_id" TEXT,
  "data_snapshot" JSONB,
  "client_snapshot" JSONB,
  "style_signals" JSONB,
  "notes" TEXT,
  "exported_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "framework_revisions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "framework_revisions_client_id_vertical_id_idx" ON "framework_revisions"("client_id", "vertical_id");
CREATE INDEX "framework_revisions_agency_id_idx" ON "framework_revisions"("agency_id");
ALTER TABLE "framework_revisions" ADD CONSTRAINT "framework_revisions_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "framework_revisions" ADD CONSTRAINT "framework_revisions_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "framework_revisions" ADD CONSTRAINT "framework_revisions_vertical_id_fkey" FOREIGN KEY ("vertical_id") REFERENCES "verticals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
