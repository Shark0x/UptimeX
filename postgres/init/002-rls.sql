\set ON_ERROR_STOP on

CREATE FUNCTION app_user_id() RETURNS bigint
LANGUAGE sql STABLE PARALLEL SAFE
RETURN NULLIF(current_setting('app.user_id', true), '')::bigint;

CREATE FUNCTION app_is_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
RETURN EXISTS (
  SELECT 1 FROM public.usuarios
  WHERE id = public.app_user_id() AND ativo AND role = 'admin'
);

CREATE FUNCTION app_can_access_empresa(target_empresa_id bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
RETURN public.app_is_admin() OR EXISTS (
  SELECT 1 FROM public.usuario_empresas ue
  JOIN public.usuarios u ON u.id = ue.usuario_id
  WHERE ue.usuario_id = public.app_user_id()
    AND ue.empresa_id = target_empresa_id
    AND ue.ativo
    AND u.ativo
);

REVOKE ALL ON FUNCTION app_user_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION app_is_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION app_can_access_empresa(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_user_id(), app_is_admin(), app_can_access_empresa(bigint)
  TO uptimex_app, uptimex_worker;

-- Login precisa localizar o hash antes de existir contexto RLS. Esta funcao
-- devolve somente a conta solicitada e nao permite enumerar a tabela.
CREATE FUNCTION auth_obter_usuario(target_username text)
RETURNS TABLE (id bigint, username varchar, senha_hash varchar, role papel_usuario,
               ativo boolean, sessao_versao integer, avatar_url varchar)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  RETURN QUERY
    SELECT u.id, u.username, u.senha_hash, u.role, u.ativo, u.sessao_versao, u.avatar_url
    FROM public.usuarios u WHERE u.username = target_username LIMIT 1;
END;
$$;

-- Resolve a sessao pelo hash do token antes de existir contexto RLS: valida a
-- sessao, atualiza last_used_at (no maximo a cada 15 min) e devolve o snapshot do
-- usuario + as empresas vinculadas. Zero linhas quando invalida/expirada/revogada.
CREATE FUNCTION auth_carregar_sessao(p_token_hash text)
RETURNS TABLE (session_id bigint, expires_at timestamp, usuario_id bigint, username varchar,
               role papel_usuario, sessao_versao integer, avatar_url varchar, empresa_ids bigint[])
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  s_id bigint; s_expires timestamp; u_id bigint; u_username varchar;
  u_role papel_usuario; u_versao integer; u_avatar varchar;
BEGIN
  SELECT s.id, s.expires_at, u.id, u.username, u.role, u.sessao_versao, u.avatar_url
    INTO s_id, s_expires, u_id, u_username, u_role, u_versao, u_avatar
  FROM public.usuario_sessoes s
  JOIN public.usuarios u ON u.id = s.usuario_id
  WHERE s.token_hash = p_token_hash
    AND s.revoked_at IS NULL
    AND s.expires_at > now()
    AND s.sessao_versao = u.sessao_versao
    AND u.ativo
  LIMIT 1;

  IF u_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.usuario_sessoes
     SET last_used_at = now()
   WHERE id = s_id AND last_used_at < now() - INTERVAL '15 minutes';

  RETURN QUERY
    SELECT s_id, s_expires, u_id, u_username, u_role, u_versao, u_avatar,
           (SELECT array_agg(ue.empresa_id ORDER BY ue.empresa_id)
              FROM public.usuario_empresas ue
             WHERE ue.usuario_id = u_id AND ue.ativo);
END;
$$;

-- Semeia o admin inicial no primeiro boot, somente se ainda nao houver admin ativo.
CREATE FUNCTION auth_seed_admin(p_username text, p_senha_hash text, p_role papel_usuario DEFAULT 'admin')
RETURNS bigint
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE novo_id bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM public.usuarios WHERE role = 'admin' AND ativo) THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.usuarios (username, senha_hash, role)
  VALUES (p_username, p_senha_hash, p_role)
  RETURNING id INTO novo_id;
  RETURN novo_id;
END;
$$;

-- Auto-servico do proprio usuario: a policy usuarios_admin_write nao permite que
-- um nao-admin altere a propria linha, e RLS nao restringe colunas. Estas funcoes
-- limitam a mudanca ao proprio id e a colunas seguras (sem role/ativo).
CREATE FUNCTION auth_alterar_senha(p_novo_hash text, p_nova_versao integer)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE public.usuarios
     SET senha_hash = p_novo_hash, sessao_versao = p_nova_versao
   WHERE id = public.app_user_id();
END;
$$;

CREATE FUNCTION auth_definir_avatar(p_avatar_url text)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE public.usuarios SET avatar_url = p_avatar_url WHERE id = public.app_user_id();
END;
$$;

-- Auditoria de eventos de login (ocorrem antes de existir contexto RLS).
CREATE FUNCTION auth_registrar_login(p_usuario_id bigint, p_usuario text, p_acao text,
                                     p_detalhes text, p_ip text)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public.auditoria (usuario_id, usuario, acao, entidade, entidade_id, detalhes, ip_origem)
  VALUES (p_usuario_id, p_usuario, p_acao, 'usuario', p_usuario_id, p_detalhes,
          CASE WHEN p_ip IS NULL OR p_ip = '' THEN NULL ELSE p_ip::inet END);
END;
$$;

-- Autorizacao de sala de socket por empresa (o handshake nao tem contexto RLS).
CREATE FUNCTION auth_pode_acessar_empresa(p_usuario_id bigint, p_empresa_id bigint)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
RETURN EXISTS (
  SELECT 1 FROM public.usuarios u
  WHERE u.id = p_usuario_id AND u.ativo
    AND (u.role = 'admin' OR EXISTS (
      SELECT 1 FROM public.usuario_empresas ue
      WHERE ue.usuario_id = p_usuario_id AND ue.empresa_id = p_empresa_id AND ue.ativo
    ))
);

REVOKE ALL ON FUNCTION auth_obter_usuario(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_carregar_sessao(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_seed_admin(text, text, papel_usuario) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_alterar_senha(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_definir_avatar(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_registrar_login(bigint, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_pode_acessar_empresa(bigint, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_obter_usuario(text), auth_carregar_sessao(text),
  auth_seed_admin(text, text, papel_usuario), auth_alterar_senha(text, integer),
  auth_definir_avatar(text), auth_registrar_login(bigint, text, text, text, text),
  auth_pode_acessar_empresa(bigint, bigint) TO uptimex_app;

ALTER TABLE usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE usuarios FORCE ROW LEVEL SECURITY;
CREATE POLICY usuarios_select ON usuarios FOR SELECT TO uptimex_app
  USING (id = app_user_id() OR app_is_admin());
CREATE POLICY usuarios_admin_write ON usuarios FOR ALL TO uptimex_app
  USING (app_is_admin()) WITH CHECK (app_is_admin());

ALTER TABLE empresas ENABLE ROW LEVEL SECURITY;
ALTER TABLE empresas FORCE ROW LEVEL SECURITY;
CREATE POLICY empresas_tenant ON empresas FOR ALL TO uptimex_app
  USING (app_can_access_empresa(id)) WITH CHECK (app_can_access_empresa(id));
CREATE POLICY empresas_worker ON empresas FOR SELECT TO uptimex_worker USING (true);

ALTER TABLE usuario_empresas ENABLE ROW LEVEL SECURITY;
ALTER TABLE usuario_empresas FORCE ROW LEVEL SECURITY;
CREATE POLICY usuario_empresas_select ON usuario_empresas FOR SELECT TO uptimex_app
  USING (usuario_id = app_user_id() OR app_is_admin());
CREATE POLICY usuario_empresas_admin_write ON usuario_empresas FOR ALL TO uptimex_app
  USING (app_is_admin()) WITH CHECK (app_is_admin());

ALTER TABLE dispositivos ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispositivos FORCE ROW LEVEL SECURITY;
CREATE POLICY dispositivos_tenant ON dispositivos FOR ALL TO uptimex_app
  USING (app_can_access_empresa(empresa_id)) WITH CHECK (app_can_access_empresa(empresa_id));
CREATE POLICY dispositivos_worker ON dispositivos FOR ALL TO uptimex_worker USING (true) WITH CHECK (true);

ALTER TABLE ping_metricas ENABLE ROW LEVEL SECURITY;
ALTER TABLE ping_metricas FORCE ROW LEVEL SECURITY;
CREATE POLICY ping_metricas_tenant ON ping_metricas FOR ALL TO uptimex_app
  USING (EXISTS (SELECT 1 FROM dispositivos d WHERE d.id = dispositivo_id))
  WITH CHECK (EXISTS (SELECT 1 FROM dispositivos d WHERE d.id = dispositivo_id));
CREATE POLICY ping_metricas_worker ON ping_metricas FOR ALL TO uptimex_worker USING (true) WITH CHECK (true);

ALTER TABLE status_eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE status_eventos FORCE ROW LEVEL SECURITY;
CREATE POLICY status_eventos_tenant ON status_eventos FOR ALL TO uptimex_app
  USING (EXISTS (SELECT 1 FROM dispositivos d WHERE d.id = dispositivo_id))
  WITH CHECK (EXISTS (SELECT 1 FROM dispositivos d WHERE d.id = dispositivo_id));
CREATE POLICY status_eventos_worker ON status_eventos FOR ALL TO uptimex_worker USING (true) WITH CHECK (true);

-- Series temporais de ping: leitura por empresa (denormalizada em empresa_id);
-- so o worker (motor + rollups + retencao) escreve.
ALTER TABLE ping_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE ping_log FORCE ROW LEVEL SECURITY;
CREATE POLICY ping_log_tenant ON ping_log FOR SELECT TO uptimex_app
  USING (app_can_access_empresa(empresa_id));
CREATE POLICY ping_log_worker ON ping_log FOR ALL TO uptimex_worker USING (true) WITH CHECK (true);

ALTER TABLE ping_log_hourly ENABLE ROW LEVEL SECURITY;
ALTER TABLE ping_log_hourly FORCE ROW LEVEL SECURITY;
CREATE POLICY ping_log_hourly_tenant ON ping_log_hourly FOR SELECT TO uptimex_app
  USING (app_can_access_empresa(empresa_id));
CREATE POLICY ping_log_hourly_worker ON ping_log_hourly FOR ALL TO uptimex_worker USING (true) WITH CHECK (true);

ALTER TABLE ping_log_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE ping_log_daily FORCE ROW LEVEL SECURITY;
CREATE POLICY ping_log_daily_tenant ON ping_log_daily FOR SELECT TO uptimex_app
  USING (app_can_access_empresa(empresa_id));
CREATE POLICY ping_log_daily_worker ON ping_log_daily FOR ALL TO uptimex_worker USING (true) WITH CHECK (true);

ALTER TABLE topologia_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE topologia_nodes FORCE ROW LEVEL SECURITY;
CREATE POLICY topologia_nodes_tenant ON topologia_nodes FOR ALL TO uptimex_app
  USING (app_can_access_empresa(empresa_id)) WITH CHECK (app_can_access_empresa(empresa_id));

ALTER TABLE topologia_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE topologia_edges FORCE ROW LEVEL SECURITY;
CREATE POLICY topologia_edges_tenant ON topologia_edges FOR ALL TO uptimex_app
  USING (app_can_access_empresa(empresa_id)) WITH CHECK (app_can_access_empresa(empresa_id));

ALTER TABLE topologia_viewport ENABLE ROW LEVEL SECURITY;
ALTER TABLE topologia_viewport FORCE ROW LEVEL SECURITY;
CREATE POLICY topologia_viewport_tenant ON topologia_viewport FOR ALL TO uptimex_app
  USING (app_can_access_empresa(empresa_id)) WITH CHECK (app_can_access_empresa(empresa_id));

ALTER TABLE links_dedicados ENABLE ROW LEVEL SECURITY;
ALTER TABLE links_dedicados FORCE ROW LEVEL SECURITY;
CREATE POLICY links_tenant ON links_dedicados FOR ALL TO uptimex_app
  USING (app_can_access_empresa(empresa_id)) WITH CHECK (app_can_access_empresa(empresa_id));

ALTER TABLE configuracoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE configuracoes FORCE ROW LEVEL SECURITY;
CREATE POLICY configuracoes_admin ON configuracoes FOR ALL TO uptimex_app
  USING (app_is_admin()) WITH CHECK (app_is_admin());
-- Worker le no boot e re-cifra segredos legados (UPDATE); grants limitam a SELECT/UPDATE.
CREATE POLICY configuracoes_worker ON configuracoes FOR ALL TO uptimex_worker USING (true) WITH CHECK (true);

ALTER TABLE usuario_sessoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE usuario_sessoes FORCE ROW LEVEL SECURITY;
CREATE POLICY usuario_sessoes_proprias ON usuario_sessoes FOR ALL TO uptimex_app
  USING (usuario_id = app_user_id() OR app_is_admin())
  WITH CHECK (usuario_id = app_user_id() OR app_is_admin());
-- Retencao (job de fundo) roda como worker e limpa sessoes expiradas.
CREATE POLICY usuario_sessoes_worker ON usuario_sessoes FOR ALL TO uptimex_worker
  USING (true) WITH CHECK (true);

ALTER TABLE mcp_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_api_keys FORCE ROW LEVEL SECURITY;
CREATE POLICY mcp_api_keys_admin ON mcp_api_keys FOR ALL TO uptimex_app
  USING (app_is_admin()) WITH CHECK (app_is_admin());

ALTER TABLE auditoria ENABLE ROW LEVEL SECURITY;
ALTER TABLE auditoria FORCE ROW LEVEL SECURITY;
CREATE POLICY auditoria_select ON auditoria FOR SELECT TO uptimex_app
  USING (app_is_admin() OR (empresa_id IS NOT NULL AND app_can_access_empresa(empresa_id)));
CREATE POLICY auditoria_insert ON auditoria FOR INSERT TO uptimex_app
  WITH CHECK (usuario_id = app_user_id() AND (empresa_id IS NULL OR app_can_access_empresa(empresa_id)));
-- Retencao (job de fundo) roda como worker: anonimiza IP antigo e apaga eventos vencidos.
CREATE POLICY auditoria_worker ON auditoria FOR ALL TO uptimex_worker
  USING (true) WITH CHECK (true);

-- Antenas: board GLOBAL do NOC (sem empresa_id). App so acessa como admin;
-- o worker (motor) atualiza status/insere metricas via policies USING(true).
ALTER TABLE antenas ENABLE ROW LEVEL SECURITY;
ALTER TABLE antenas FORCE ROW LEVEL SECURITY;
CREATE POLICY antenas_admin ON antenas FOR ALL TO uptimex_app
  USING (app_is_admin()) WITH CHECK (app_is_admin());
CREATE POLICY antenas_worker ON antenas FOR ALL TO uptimex_worker USING (true) WITH CHECK (true);

ALTER TABLE antenas_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE antenas_nodes FORCE ROW LEVEL SECURITY;
CREATE POLICY antenas_nodes_admin ON antenas_nodes FOR ALL TO uptimex_app
  USING (app_is_admin()) WITH CHECK (app_is_admin());

ALTER TABLE antenas_enlaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE antenas_enlaces FORCE ROW LEVEL SECURITY;
CREATE POLICY antenas_enlaces_admin ON antenas_enlaces FOR ALL TO uptimex_app
  USING (app_is_admin()) WITH CHECK (app_is_admin());

ALTER TABLE antenas_viewport ENABLE ROW LEVEL SECURITY;
ALTER TABLE antenas_viewport FORCE ROW LEVEL SECURITY;
CREATE POLICY antenas_viewport_admin ON antenas_viewport FOR ALL TO uptimex_app
  USING (app_is_admin()) WITH CHECK (app_is_admin());

ALTER TABLE antenas_metricas ENABLE ROW LEVEL SECURITY;
ALTER TABLE antenas_metricas FORCE ROW LEVEL SECURITY;
CREATE POLICY antenas_metricas_admin ON antenas_metricas FOR ALL TO uptimex_app
  USING (app_is_admin()) WITH CHECK (app_is_admin());
CREATE POLICY antenas_metricas_worker ON antenas_metricas FOR ALL TO uptimex_worker USING (true) WITH CHECK (true);

GRANT USAGE ON SCHEMA public TO uptimex_app, uptimex_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO uptimex_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO uptimex_app;
GRANT SELECT ON empresas TO uptimex_worker;
GRANT SELECT, UPDATE ON configuracoes TO uptimex_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON dispositivos, ping_metricas, status_eventos,
  ping_log, ping_log_hourly, ping_log_daily, antenas, antenas_metricas,
  auditoria, usuario_sessoes TO uptimex_worker;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO uptimex_worker;

ALTER DEFAULT PRIVILEGES REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES REVOKE ALL ON SEQUENCES FROM PUBLIC;
