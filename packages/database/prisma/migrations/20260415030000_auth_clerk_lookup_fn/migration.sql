-- get_user_by_clerk_id: resolves agency_id + role from a Clerk user ID.
-- Called by the auth layer BEFORE the RLS context (app.current_agency_id) is set,
-- so SECURITY DEFINER is required to bypass FORCE ROW LEVEL SECURITY on the users table.
-- Without this, the query would see 0 rows and every unauthenticated user would get 403.

CREATE OR REPLACE FUNCTION get_user_by_clerk_id(p_clerk_id TEXT)
RETURNS TABLE(agency_id TEXT, role TEXT)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT u.agency_id, u.role
  FROM   users u
  WHERE  u.clerk_user_id = p_clerk_id
  LIMIT  1;
$$;
