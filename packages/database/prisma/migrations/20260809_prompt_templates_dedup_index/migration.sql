-- Step 1: Remove duplicate prompt_templates, keeping the oldest row per
-- (agency_id, effective_client_id, name) group. Only non-deleted rows are
-- considered — soft-deleted rows are left untouched even if they are duplicates.
DELETE FROM prompt_templates
WHERE id IN (
  SELECT id FROM (
    SELECT id,
      ROW_NUMBER() OVER (
        PARTITION BY agency_id, COALESCE(client_id, ''), name
        ORDER BY created_at ASC
      ) AS rn
    FROM prompt_templates
    WHERE deleted_at IS NULL
  ) ranked
  WHERE rn > 1
);

-- Step 2: Add a unique expression index so the application cannot create
-- duplicates going forward. COALESCE collapses NULL client_id to '' so that
-- global templates (client_id IS NULL) are also protected — PostgreSQL's
-- standard UNIQUE constraint would allow unlimited NULLs without this.
-- The partial predicate (deleted_at IS NULL) keeps soft-deleted rows out of
-- the constraint so a name can be re-used after a template is deleted.
CREATE UNIQUE INDEX prompt_templates_agency_client_name_uidx
  ON prompt_templates (agency_id, COALESCE(client_id, ''), name)
  WHERE deleted_at IS NULL;
