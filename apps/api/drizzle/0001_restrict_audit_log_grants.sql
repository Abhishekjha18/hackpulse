-- ADR-009 / NFR-AUDIT-02: the audit log must be tamper-evident at the
-- database level, not merely by convention in the service layer. The
-- migration/owner role (from DATABASE_URL) keeps full DDL rights so it can
-- alter the schema over time; the runtime application connects as a
-- separate, less-privileged role that can INSERT and SELECT everywhere but
-- can never UPDATE or DELETE audit_log_entries — so a compromised or buggy
-- service layer still cannot rewrite history.
-- Dev-only fixed password, matching docker-compose.yml's convention for the
-- owner role. Rotate via ALTER ROLE for any non-local deployment.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'hackpulse_app') THEN
    CREATE ROLE hackpulse_app WITH LOGIN PASSWORD 'hackpulse_app_dev_only';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO hackpulse_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO hackpulse_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO hackpulse_app;

-- The one deliberate restriction: no rewriting or erasing audit history.
REVOKE UPDATE, DELETE ON audit_log_entries FROM hackpulse_app;

-- Future tables default to the same baseline grant so this doesn't have to
-- be repeated per migration; audit_log_entries' restriction above still
-- applies to it specifically since it already exists.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO hackpulse_app;
