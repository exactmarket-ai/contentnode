-- Add soft-delete fields to prompt_templates
ALTER TABLE "prompt_templates" ADD COLUMN "deleted_at" TIMESTAMP(3);
ALTER TABLE "prompt_templates" ADD COLUMN "deleted_by" TEXT;

-- Add created_by and soft-delete fields to image_prompts
ALTER TABLE "image_prompts" ADD COLUMN "created_by" TEXT;
ALTER TABLE "image_prompts" ADD COLUMN "deleted_at" TIMESTAMP(3);
ALTER TABLE "image_prompts" ADD COLUMN "deleted_by" TEXT;
