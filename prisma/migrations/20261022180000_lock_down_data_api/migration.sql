-- Phase 16: close the Supabase Data API to FARJI's schema (docs/PHASE16_SECURITY.md, finding S-01).
--
-- FARJI never uses the Supabase Data API: every read and write goes through the server with Prisma as the table owner
-- (`postgres`, which owns the tables and bypasses RLS). Supabase nevertheless grants the `anon` and `authenticated` roles full
-- privileges on tables created in `public`, and `_prisma_migrations` (created by Prisma, not by a FARJI migration) had RLS
-- disabled, so anyone holding the PUBLIC publishable key could read and modify the migration history over the Data API.
-- The FARJI tables were already protected by RLS with no policies; the grants are removed too as defence in depth.
--
-- No table, column, index or row changes. Prisma is unaffected (it connects as the owner). Guarded so the migration also
-- applies to a plain PostgreSQL database that has no Supabase roles.

ALTER TABLE "_prisma_migrations" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', r);
    END IF;
  END LOOP;
END
$$;
