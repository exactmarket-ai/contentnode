-- ─────────────────────────────────────────────────────────────────────────────
-- Row Level Security
-- We use a session-local GUC `app.current_agency_id` that the application
-- layer sets at the start of every transaction:
--   SET LOCAL app.current_agency_id = '<agency-id>';
-- RLS policies then compare each row's agency_id against this setting.
-- The Prisma middleware handles this at the query layer; RLS is a defence-in-depth.
-- ─────────────────────────────────────────────────────────────────────────────

-- Helper function to read the current agency from session config.
-- Returns NULL when not set so the policy safely rejects all rows
-- rather than allowing everything.
CREATE OR REPLACE FUNCTION current_agency_id() RETURNS text AS $$
  SELECT current_setting('app.current_agency_id', true);
$$ LANGUAGE sql STABLE;

-- ── Enable RLS ───────────────────────────────────────────────────────────────

ALTER TABLE clients              ENABLE ROW LEVEL SECURITY;
ALTER TABLE stakeholders         ENABLE ROW LEVEL SECURITY;
ALTER TABLE users                ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflows            ENABLE ROW LEVEL SECURITY;
ALTER TABLE nodes                ENABLE ROW LEVEL SECURITY;
ALTER TABLE edges                ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents            ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_runs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedbacks            ENABLE ROW LEVEL SECURITY;
ALTER TABLE transcript_sessions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE transcript_segments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE insights             ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_records        ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs           ENABLE ROW LEVEL SECURITY;

-- FORCE RLS applies even to the table owner (superuser bypasses FORCE too,
-- but the app role does not have superuser).
ALTER TABLE clients              FORCE ROW LEVEL SECURITY;
ALTER TABLE stakeholders         FORCE ROW LEVEL SECURITY;
ALTER TABLE users                FORCE ROW LEVEL SECURITY;
ALTER TABLE workflows            FORCE ROW LEVEL SECURITY;
ALTER TABLE nodes                FORCE ROW LEVEL SECURITY;
ALTER TABLE edges                FORCE ROW LEVEL SECURITY;
ALTER TABLE documents            FORCE ROW LEVEL SECURITY;
ALTER TABLE workflow_runs        FORCE ROW LEVEL SECURITY;
ALTER TABLE feedbacks            FORCE ROW LEVEL SECURITY;
ALTER TABLE transcript_sessions  FORCE ROW LEVEL SECURITY;
ALTER TABLE transcript_segments  FORCE ROW LEVEL SECURITY;
ALTER TABLE insights             FORCE ROW LEVEL SECURITY;
ALTER TABLE usage_records        FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_logs           FORCE ROW LEVEL SECURITY;

-- ── Policies ─────────────────────────────────────────────────────────────────
-- One policy per table. Applies to SELECT, INSERT, UPDATE, DELETE.

CREATE POLICY agency_isolation ON clients
  USING (agency_id = current_agency_id())
  WITH CHECK (agency_id = current_agency_id());

CREATE POLICY agency_isolation ON stakeholders
  USING (agency_id = current_agency_id())
  WITH CHECK (agency_id = current_agency_id());

CREATE POLICY agency_isolation ON users
  USING (agency_id = current_agency_id())
  WITH CHECK (agency_id = current_agency_id());

CREATE POLICY agency_isolation ON workflows
  USING (agency_id = current_agency_id())
  WITH CHECK (agency_id = current_agency_id());

CREATE POLICY agency_isolation ON nodes
  USING (agency_id = current_agency_id())
  WITH CHECK (agency_id = current_agency_id());

CREATE POLICY agency_isolation ON edges
  USING (agency_id = current_agency_id())
  WITH CHECK (agency_id = current_agency_id());

CREATE POLICY agency_isolation ON documents
  USING (agency_id = current_agency_id())
  WITH CHECK (agency_id = current_agency_id());

CREATE POLICY agency_isolation ON workflow_runs
  USING (agency_id = current_agency_id())
  WITH CHECK (agency_id = current_agency_id());

CREATE POLICY agency_isolation ON feedbacks
  USING (agency_id = current_agency_id())
  WITH CHECK (agency_id = current_agency_id());

CREATE POLICY agency_isolation ON transcript_sessions
  USING (agency_id = current_agency_id())
  WITH CHECK (agency_id = current_agency_id());

CREATE POLICY agency_isolation ON transcript_segments
  USING (agency_id = current_agency_id())
  WITH CHECK (agency_id = current_agency_id());

CREATE POLICY agency_isolation ON insights
  USING (agency_id = current_agency_id())
  WITH CHECK (agency_id = current_agency_id());

CREATE POLICY agency_isolation ON usage_records
  USING (agency_id = current_agency_id())
  WITH CHECK (agency_id = current_agency_id());

CREATE POLICY agency_isolation ON audit_logs
  USING (agency_id = current_agency_id())
  WITH CHECK (agency_id = current_agency_id());
