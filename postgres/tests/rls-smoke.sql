\set ON_ERROR_STOP on
BEGIN;

INSERT INTO usuarios (id, username, senha_hash, role) VALUES
  (-101, 'rls_admin', 'teste', 'admin'),
  (-102, 'rls_tenant_a', 'teste', 'visualizador'),
  (-103, 'rls_tenant_b', 'teste', 'visualizador');
INSERT INTO empresas (id, nome) VALUES (-201, 'RLS Empresa A'), (-202, 'RLS Empresa B');
INSERT INTO usuario_empresas (usuario_id, empresa_id) VALUES (-102, -201), (-103, -202);
INSERT INTO dispositivos (id, empresa_id, nome, ip) VALUES
  (-301, -201, 'RLS Device A', '192.0.2.1'),
  (-302, -202, 'RLS Device B', '198.51.100.1');

SET ROLE uptimex_app;
SELECT set_config('app.user_id', '-102', true);
DO $$
BEGIN
  IF (SELECT count(*) FROM empresas) <> 1 THEN
    RAISE EXCEPTION 'RLS falhou: tenant A nao enxerga exatamente uma empresa';
  END IF;
  IF EXISTS (SELECT 1 FROM empresas WHERE id = -202) THEN
    RAISE EXCEPTION 'RLS falhou: tenant A enxergou tenant B';
  END IF;
  IF (SELECT count(*) FROM dispositivos) <> 1 THEN
    RAISE EXCEPTION 'RLS falhou na tabela dispositivos';
  END IF;
END $$;

SELECT set_config('app.user_id', '-101', true);
DO $$
BEGIN
  IF (SELECT count(*) FROM empresas WHERE id IN (-201, -202)) <> 2 THEN
    RAISE EXCEPTION 'RLS falhou: admin nao enxerga todas as empresas';
  END IF;
END $$;

RESET ROLE;
ROLLBACK;
\echo 'RLS smoke test: OK'
