CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "resource_id" TEXT,
    "resource_type" TEXT,
    "client_id" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "notifications_agency_id_user_id_read_idx" ON "notifications"("agency_id", "user_id", "read");
CREATE INDEX "notifications_agency_id_user_id_created_at_idx" ON "notifications"("agency_id", "user_id", "created_at" DESC);

ALTER TABLE "notifications" ADD CONSTRAINT "notifications_agency_id_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
