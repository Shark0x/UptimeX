-- Patch RLS: papéis internos (admin/operador/visualizador) enxergam TODO o
-- monitoramento; escrita continua só para admin/operador; visualizador é
-- somente-leitura também no banco. Admin segue exclusivo em usuários,
-- configurações, chaves MCP e auditoria global.
--
-- Idempotente: pode rodar mais de uma vez. Aplicar em produção com:
--   docker compose exec -T postgres \
--     psql -v ON_ERROR_STOP=1 -U uptimex_owner -d uptimex \
--     < postgres/migration/patch-papeis-staff-rls.sql
--
-- Não altera dados; só funções e políticas RLS.

\set ON_ERROR_STOP on

BEGIN;

-- 1) Funções de papel -------------------------------------------------------
-- Staff interno: qualquer usuário ativo (admin/operador/visualizador). Leitura global.
CREATE OR REPLACE FUNCTION app_is_staff() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
RETURN EXISTS (
  SELECT 1 FROM public.usuarios
  WHERE id = public.app_user_id() AND ativo
    AND role IN ('admin', 'operador', 'visualizador')
);

-- Pode ESCREVER dados operacionais: admin ou operador. Visualizador NÃO opera.
CREATE OR REPLACE FUNCTION app_can_operate() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
RETURN EXISTS (
  SELECT 1 FROM public.usuarios
  WHERE id = public.app_user_id() AND ativo
    AND role IN ('admin', 'operador')
);

REVOKE ALL ON FUNCTION app_is_staff() FROM PUBLIC;
REVOKE ALL ON FUNCTION app_can_operate() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_is_staff(), app_can_operate() TO uptimex_app, uptimex_worker;

-- 2) Empresas ---------------------------------------------------------------
DROP POLICY IF EXISTS empresas_tenant ON empresas;
DROP POLICY IF EXISTS empresas_read ON empresas;
DROP POLICY IF EXISTS empresas_write ON empresas;
CREATE POLICY empresas_read ON empresas FOR SELECT TO uptimex_app
  USING (app_is_staff());
CREATE POLICY empresas_write ON empresas FOR ALL TO uptimex_app
  USING (app_can_operate()) WITH CHECK (app_can_operate());

-- 3) Dispositivos -----------------------------------------------------------
DROP POLICY IF EXISTS dispositivos_tenant ON dispositivos;
DROP POLICY IF EXISTS dispositivos_read ON dispositivos;
DROP POLICY IF EXISTS dispositivos_write ON dispositivos;
CREATE POLICY dispositivos_read ON dispositivos FOR SELECT TO uptimex_app
  USING (app_is_staff());
CREATE POLICY dispositivos_write ON dispositivos FOR ALL TO uptimex_app
  USING (app_can_operate()) WITH CHECK (app_can_operate());

-- 4) Histórico de ping (só leitura no app; worker escreve) ------------------
DROP POLICY IF EXISTS ping_log_tenant ON ping_log;
CREATE POLICY ping_log_tenant ON ping_log FOR SELECT TO uptimex_app
  USING (app_is_staff());
DROP POLICY IF EXISTS ping_log_hourly_tenant ON ping_log_hourly;
CREATE POLICY ping_log_hourly_tenant ON ping_log_hourly FOR SELECT TO uptimex_app
  USING (app_is_staff());
DROP POLICY IF EXISTS ping_log_daily_tenant ON ping_log_daily;
CREATE POLICY ping_log_daily_tenant ON ping_log_daily FOR SELECT TO uptimex_app
  USING (app_is_staff());

-- 5) Topologia (nós/enlaces/viewport) ---------------------------------------
DROP POLICY IF EXISTS topologia_nodes_tenant ON topologia_nodes;
DROP POLICY IF EXISTS topologia_nodes_read ON topologia_nodes;
DROP POLICY IF EXISTS topologia_nodes_write ON topologia_nodes;
CREATE POLICY topologia_nodes_read ON topologia_nodes FOR SELECT TO uptimex_app
  USING (app_is_staff());
CREATE POLICY topologia_nodes_write ON topologia_nodes FOR ALL TO uptimex_app
  USING (app_can_operate()) WITH CHECK (app_can_operate());

DROP POLICY IF EXISTS topologia_edges_tenant ON topologia_edges;
DROP POLICY IF EXISTS topologia_edges_read ON topologia_edges;
DROP POLICY IF EXISTS topologia_edges_write ON topologia_edges;
CREATE POLICY topologia_edges_read ON topologia_edges FOR SELECT TO uptimex_app
  USING (app_is_staff());
CREATE POLICY topologia_edges_write ON topologia_edges FOR ALL TO uptimex_app
  USING (app_can_operate()) WITH CHECK (app_can_operate());

DROP POLICY IF EXISTS topologia_viewport_tenant ON topologia_viewport;
DROP POLICY IF EXISTS topologia_viewport_read ON topologia_viewport;
DROP POLICY IF EXISTS topologia_viewport_write ON topologia_viewport;
CREATE POLICY topologia_viewport_read ON topologia_viewport FOR SELECT TO uptimex_app
  USING (app_is_staff());
CREATE POLICY topologia_viewport_write ON topologia_viewport FOR ALL TO uptimex_app
  USING (app_can_operate()) WITH CHECK (app_can_operate());

-- 6) Links dedicados --------------------------------------------------------
DROP POLICY IF EXISTS links_tenant ON links_dedicados;
DROP POLICY IF EXISTS links_read ON links_dedicados;
DROP POLICY IF EXISTS links_write ON links_dedicados;
CREATE POLICY links_read ON links_dedicados FOR SELECT TO uptimex_app
  USING (app_is_staff());
CREATE POLICY links_write ON links_dedicados FOR ALL TO uptimex_app
  USING (app_can_operate()) WITH CHECK (app_can_operate());

-- 7) Antenas: board global do NOC (antes era admin-only) --------------------
DROP POLICY IF EXISTS antenas_admin ON antenas;
DROP POLICY IF EXISTS antenas_read ON antenas;
DROP POLICY IF EXISTS antenas_write ON antenas;
CREATE POLICY antenas_read ON antenas FOR SELECT TO uptimex_app
  USING (app_is_staff());
CREATE POLICY antenas_write ON antenas FOR ALL TO uptimex_app
  USING (app_can_operate()) WITH CHECK (app_can_operate());

DROP POLICY IF EXISTS antenas_nodes_admin ON antenas_nodes;
DROP POLICY IF EXISTS antenas_nodes_read ON antenas_nodes;
DROP POLICY IF EXISTS antenas_nodes_write ON antenas_nodes;
CREATE POLICY antenas_nodes_read ON antenas_nodes FOR SELECT TO uptimex_app
  USING (app_is_staff());
CREATE POLICY antenas_nodes_write ON antenas_nodes FOR ALL TO uptimex_app
  USING (app_can_operate()) WITH CHECK (app_can_operate());

DROP POLICY IF EXISTS antenas_enlaces_admin ON antenas_enlaces;
DROP POLICY IF EXISTS antenas_enlaces_read ON antenas_enlaces;
DROP POLICY IF EXISTS antenas_enlaces_write ON antenas_enlaces;
CREATE POLICY antenas_enlaces_read ON antenas_enlaces FOR SELECT TO uptimex_app
  USING (app_is_staff());
CREATE POLICY antenas_enlaces_write ON antenas_enlaces FOR ALL TO uptimex_app
  USING (app_can_operate()) WITH CHECK (app_can_operate());

DROP POLICY IF EXISTS antenas_viewport_admin ON antenas_viewport;
DROP POLICY IF EXISTS antenas_viewport_read ON antenas_viewport;
DROP POLICY IF EXISTS antenas_viewport_write ON antenas_viewport;
CREATE POLICY antenas_viewport_read ON antenas_viewport FOR SELECT TO uptimex_app
  USING (app_is_staff());
CREATE POLICY antenas_viewport_write ON antenas_viewport FOR ALL TO uptimex_app
  USING (app_can_operate()) WITH CHECK (app_can_operate());

DROP POLICY IF EXISTS antenas_metricas_admin ON antenas_metricas;
DROP POLICY IF EXISTS antenas_metricas_read ON antenas_metricas;
DROP POLICY IF EXISTS antenas_metricas_write ON antenas_metricas;
CREATE POLICY antenas_metricas_read ON antenas_metricas FOR SELECT TO uptimex_app
  USING (app_is_staff());
CREATE POLICY antenas_metricas_write ON antenas_metricas FOR ALL TO uptimex_app
  USING (app_can_operate()) WITH CHECK (app_can_operate());

COMMIT;
