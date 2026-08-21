\set ON_ERROR_STOP on

DO $$
DECLARE missing_rls text;
BEGIN
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO missing_rls
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
    AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity);
  IF missing_rls IS NOT NULL THEN
    RAISE EXCEPTION 'Tabelas sem ENABLE/FORCE RLS: %', missing_rls;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('uptimex_app','uptimex_worker') AND rolsuper) THEN
    RAISE EXCEPTION 'Papel da aplicacao/worker nao pode ser SUPERUSER';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('uptimex_app','uptimex_worker') AND rolbypassrls) THEN
    RAISE EXCEPTION 'Papel da aplicacao/worker nao pode ter BYPASSRLS';
  END IF;
END $$;
