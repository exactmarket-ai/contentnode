-- Make clientId optional on Workflow (supports org-level / prospect workflows)
-- 1. Drop the existing CASCADE foreign key
ALTER TABLE "workflows" DROP CONSTRAINT IF EXISTS "workflows_client_id_fkey";

-- 2. Allow NULL on the column
ALTER TABLE "workflows" ALTER COLUMN "client_id" DROP NOT NULL;

-- 3. Re-add foreign key with SET NULL so deleting a client doesn't cascade-delete workflows
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_client_id_fkey"
  FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
