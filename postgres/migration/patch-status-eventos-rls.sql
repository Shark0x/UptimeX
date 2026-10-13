-- Patch RLS: status_eventos deve permitir leitura por staff (como links_dedicados)
-- A política antiga bloqueava porque fazia um JOIN que não considerava tenant/staff.

\set ON_ERROR_STOP on

BEGIN;

-- Remover políticas antigas
DROP POLICY IF EXISTS status_eventos_tenant ON status_eventos;
DROP POLICY IF EXISTS status_eventos_worker ON status_eventos;

-- Política nova: staff lê tudo (como links_dedicados)
CREATE POLICY status_eventos_read ON status_eventos FOR SELECT TO uptimex_app
  USING (app_is_staff());

-- Worker escreve tudo
CREATE POLICY status_eventos_worker ON status_eventos FOR ALL TO uptimex_worker
  USING (true) WITH CHECK (true);

COMMIT;
