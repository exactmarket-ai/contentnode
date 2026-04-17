-- Make clientId optional on Workflow (supports org-level / prospect workflows)
ALTER TABLE "workflows" ALTER COLUMN "client_id" DROP NOT NULL;
