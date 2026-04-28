CREATE TABLE "image_prompts" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "client_id" TEXT,
    "name" TEXT NOT NULL,
    "prompt_text" TEXT NOT NULL,
    "style_tags" TEXT NOT NULL DEFAULT '',
    "notes" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "image_prompts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "image_prompts_agency_id_idx" ON "image_prompts"("agency_id");
CREATE INDEX "image_prompts_client_id_idx" ON "image_prompts"("client_id");

ALTER TABLE "image_prompts" ADD CONSTRAINT "image_prompts_agency_id_fkey"
  FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "image_prompts" ADD CONSTRAINT "image_prompts_client_id_fkey"
  FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
