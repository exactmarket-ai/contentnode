ALTER TABLE "scheduled_tasks"
  ADD COLUMN "auto_generate"            BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "auto_generate_blog_count" INTEGER NOT NULL DEFAULT 2;
