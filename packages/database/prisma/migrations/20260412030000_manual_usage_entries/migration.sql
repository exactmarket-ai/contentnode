-- CreateTable
CREATE TABLE "manual_usage_entries" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "service" TEXT NOT NULL,
    "description" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'minutes',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "manual_usage_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "manual_usage_entries_agency_id_idx" ON "manual_usage_entries"("agency_id");

-- CreateIndex
CREATE INDEX "manual_usage_entries_client_id_idx" ON "manual_usage_entries"("client_id");

-- AddForeignKey
ALTER TABLE "manual_usage_entries" ADD CONSTRAINT "manual_usage_entries_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_usage_entries" ADD CONSTRAINT "manual_usage_entries_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
