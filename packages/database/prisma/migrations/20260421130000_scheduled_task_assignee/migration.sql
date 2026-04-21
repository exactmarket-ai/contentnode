ALTER TABLE "scheduled_tasks" ADD COLUMN "assignee_id" TEXT;
ALTER TABLE "scheduled_tasks" ADD CONSTRAINT "scheduled_tasks_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
