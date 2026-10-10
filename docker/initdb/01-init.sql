-- Runs once, as the superuser, the first time the Postgres container
-- initialises. It provisions the restricted runtime role and grants it DML on
-- everything the owner (ldms_owner) creates later via migrations. Schema DDL
-- and extensions are owned by the migration pipeline, not this script.
--
--   ldms_owner : owns the tables, runs migrations (the POSTGRES_USER)
--   ldms_app   : the application's runtime role; not a superuser, cannot bypass
--                Row Level Security

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ldms_app') THEN
    CREATE ROLE ldms_app LOGIN PASSWORD 'ldms_app';
  END IF;
END
$$;

GRANT CONNECT ON DATABASE ldms TO ldms_app;
GRANT USAGE ON SCHEMA public TO ldms_app;

-- Apply to objects created by the migration role from here on.
ALTER DEFAULT PRIVILEGES FOR ROLE ldms_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ldms_app;
ALTER DEFAULT PRIVILEGES FOR ROLE ldms_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO ldms_app;
