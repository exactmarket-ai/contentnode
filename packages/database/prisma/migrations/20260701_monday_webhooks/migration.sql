CREATE TABLE "monday_webhooks" (
  "id"         TEXT NOT NULL,
  "agency_id"  TEXT NOT NULL,
  "board_id"   TEXT NOT NULL,
  "webhook_id" TEXT NOT NULL,
  "event"      TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "monday_webhooks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "monday_webhooks_webhook_id_key" ON "monday_webhooks"("webhook_id");
CREATE INDEX "monday_webhooks_agency_id_board_id_idx" ON "monday_webhooks"("agency_id", "board_id");

ALTER TABLE "monday_webhooks" ADD CONSTRAINT "monday_webhooks_agency_id_fkey"
  FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
