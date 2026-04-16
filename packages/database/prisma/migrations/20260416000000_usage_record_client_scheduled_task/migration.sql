-- Add client_id and scheduled_task_id to usage_records for per-client cost tracking

ALTER TABLE usage_records
  ADD COLUMN IF NOT EXISTS client_id TEXT REFERENCES clients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS scheduled_task_id TEXT REFERENCES scheduled_tasks(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS usage_records_client_id_idx ON usage_records(client_id);
CREATE INDEX IF NOT EXISTS usage_records_scheduled_task_id_idx ON usage_records(scheduled_task_id);
