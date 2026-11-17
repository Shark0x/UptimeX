-- ============================================================================
-- Engine SNMP Nativo — schema, RLS e grants.
--
-- IDEMPOTENTE de propósito: roda no primeiro boot (docker-entrypoint-initdb.d,
-- após 002-rls.sql) E é reaplicado pelo instalador em atualizações de instalações
-- já existentes, sem nunca apagar dados (só CREATE IF NOT EXISTS / ADD COLUMN IF
-- NOT EXISTS / DROP+CREATE de policies). Nenhum DROP TABLE, nenhum TRUNCATE.
-- ============================================================================
\set ON_ERROR_STOP on

-- ---- Credenciais SNMPv3 no dispositivo (v2c segue em comunidade_snmp) --------
-- As senhas auth/priv são guardadas cifradas (AES-GCM, mesmo cofre da comunidade).
ALTER TABLE dispositivos ADD COLUMN IF NOT EXISTS snmp_versao varchar(4) NOT NULL DEFAULT 'v2c'
  CHECK (snmp_versao IN ('v2c', 'v3'));
ALTER TABLE dispositivos ADD COLUMN IF NOT EXISTS snmp_usuario varchar(100);
ALTER TABLE dispositivos ADD COLUMN IF NOT EXISTS snmp_nivel varchar(20)
  CHECK (snmp_nivel IS NULL OR snmp_nivel IN ('noAuthNoPriv', 'authNoPriv', 'authPriv'));
ALTER TABLE dispositivos ADD COLUMN IF NOT EXISTS snmp_auth_protocolo varchar(10);
ALTER TABLE dispositivos ADD COLUMN IF NOT EXISTS snmp_auth_senha varchar(500);
ALTER TABLE dispositivos ADD COLUMN IF NOT EXISTS snmp_priv_protocolo varchar(10);
ALTER TABLE dispositivos ADD COLUMN IF NOT EXISTS snmp_priv_senha varchar(500);

-- ---- Interfaces descobertas + estado persistido dos contadores ---------------
-- last_* guarda a leitura bruta anterior (Counter64 cabe em numeric(20,0)) para o
-- cálculo de delta do próximo ciclo ficar NO BANCO, não em memória.
CREATE TABLE IF NOT EXISTS snmp_interfaces (
  dispositivo_id bigint NOT NULL REFERENCES dispositivos(id) ON DELETE CASCADE,
  empresa_id bigint NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  if_index integer NOT NULL,
  if_descr varchar(255),
  if_name varchar(255),
  if_alias varchar(255),
  if_type integer,
  capacidade_bps bigint CHECK (capacidade_bps IS NULL OR capacidade_bps >= 0),
  admin_status integer,
  oper_status integer,
  largura_octetos smallint NOT NULL DEFAULT 64,
  last_in_octets numeric(20, 0),
  last_out_octets numeric(20, 0),
  last_in_errors numeric(20, 0),
  last_out_errors numeric(20, 0),
  last_in_discards numeric(20, 0),
  last_out_discards numeric(20, 0),
  last_uptime_ticks bigint,
  last_sample_at timestamp without time zone,
  in_bps double precision,
  out_bps double precision,
  visivel boolean NOT NULL DEFAULT true,
  atualizado_em timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (dispositivo_id, if_index)
);

-- Série temporal de tráfego por interface (bps) e erros/descartes (pps).
CREATE TABLE IF NOT EXISTS snmp_interface_amostras (
  dispositivo_id bigint NOT NULL REFERENCES dispositivos(id) ON DELETE CASCADE,
  empresa_id bigint NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  if_index integer NOT NULL,
  "timestamp" timestamp(3) without time zone NOT NULL,
  in_bps double precision,
  out_bps double precision,
  in_err_pps double precision,
  out_err_pps double precision,
  in_disc_pps double precision,
  out_disc_pps double precision,
  UNIQUE (dispositivo_id, if_index, "timestamp")
);

-- Estado da coleta SNMP por dispositivo (persistido, não em memória). Alimenta o
-- indicador de "coleta atrasada/desatualizada" no frontend.
CREATE TABLE IF NOT EXISTS snmp_coleta (
  dispositivo_id bigint PRIMARY KEY REFERENCES dispositivos(id) ON DELETE CASCADE,
  empresa_id bigint NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  status varchar(16) NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('ok', 'erro', 'stale', 'sem_credencial', 'pendente')),
  sys_uptime_ticks bigint,
  sys_descr varchar(255),
  sys_name varchar(255),
  ultima_coleta_at timestamp without time zone,
  ultimo_sucesso_at timestamp without time zone,
  falhas_consecutivas integer NOT NULL DEFAULT 0,
  erro varchar(255),
  total_interfaces integer NOT NULL DEFAULT 0,
  cpu_pct double precision,
  cpu_cores integer,
  memoria_uso_bytes bigint,
  memoria_total_bytes bigint,
  memoria_pct double precision,
  disco_uso_bytes bigint,
  disco_total_bytes bigint,
  disco_pct double precision,
  atualizado_em timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Idempotência para bases existentes: garante colunas de recursos de servidor
ALTER TABLE snmp_coleta ADD COLUMN IF NOT EXISTS cpu_pct double precision;
ALTER TABLE snmp_coleta ADD COLUMN IF NOT EXISTS cpu_cores integer;
ALTER TABLE snmp_coleta ADD COLUMN IF NOT EXISTS memoria_uso_bytes bigint;
ALTER TABLE snmp_coleta ADD COLUMN IF NOT EXISTS memoria_total_bytes bigint;
ALTER TABLE snmp_coleta ADD COLUMN IF NOT EXISTS memoria_pct double precision;
ALTER TABLE snmp_coleta ADD COLUMN IF NOT EXISTS disco_uso_bytes bigint;
ALTER TABLE snmp_coleta ADD COLUMN IF NOT EXISTS disco_total_bytes bigint;
ALTER TABLE snmp_coleta ADD COLUMN IF NOT EXISTS disco_pct double precision;

-- Série temporal de recursos por dispositivo (CPU, RAM, Disco).
CREATE TABLE IF NOT EXISTS snmp_recursos_amostras (
  dispositivo_id bigint NOT NULL REFERENCES dispositivos(id) ON DELETE CASCADE,
  empresa_id bigint NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  "timestamp" timestamp(3) without time zone NOT NULL,
  cpu_pct double precision,
  cpu_cores integer,
  memoria_pct double precision,
  memoria_uso_bytes bigint,
  memoria_total_bytes bigint,
  disco_pct double precision,
  disco_uso_bytes bigint,
  disco_total_bytes bigint,
  UNIQUE (dispositivo_id, "timestamp")
);

CREATE INDEX IF NOT EXISTS idx_snmp_interfaces_empresa ON snmp_interfaces(empresa_id);
CREATE INDEX IF NOT EXISTS idx_snmp_amostras_dev_if_ts
  ON snmp_interface_amostras(dispositivo_id, if_index, "timestamp");
CREATE INDEX IF NOT EXISTS idx_snmp_amostras_empresa_ts
  ON snmp_interface_amostras(empresa_id, "timestamp");
CREATE INDEX IF NOT EXISTS idx_snmp_recursos_dev_ts
  ON snmp_recursos_amostras(dispositivo_id, "timestamp");
CREATE INDEX IF NOT EXISTS idx_snmp_recursos_empresa_ts
  ON snmp_recursos_amostras(empresa_id, "timestamp");

-- ---- RLS: app (staff) lê; worker (motor) escreve. Mesmo padrão do ping_log. ---
ALTER TABLE snmp_interfaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE snmp_interfaces FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS snmp_interfaces_read ON snmp_interfaces;
CREATE POLICY snmp_interfaces_read ON snmp_interfaces FOR SELECT TO uptimex_app USING (app_is_staff());
DROP POLICY IF EXISTS snmp_interfaces_worker ON snmp_interfaces;
CREATE POLICY snmp_interfaces_worker ON snmp_interfaces FOR ALL TO uptimex_worker USING (true) WITH CHECK (true);

ALTER TABLE snmp_interface_amostras ENABLE ROW LEVEL SECURITY;
ALTER TABLE snmp_interface_amostras FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS snmp_amostras_read ON snmp_interface_amostras;
CREATE POLICY snmp_amostras_read ON snmp_interface_amostras FOR SELECT TO uptimex_app USING (app_is_staff());
DROP POLICY IF EXISTS snmp_amostras_worker ON snmp_interface_amostras;
CREATE POLICY snmp_amostras_worker ON snmp_interface_amostras FOR ALL TO uptimex_worker USING (true) WITH CHECK (true);

ALTER TABLE snmp_coleta ENABLE ROW LEVEL SECURITY;
ALTER TABLE snmp_coleta FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS snmp_coleta_read ON snmp_coleta;
CREATE POLICY snmp_coleta_read ON snmp_coleta FOR SELECT TO uptimex_app USING (app_is_staff());
DROP POLICY IF EXISTS snmp_coleta_worker ON snmp_coleta;
CREATE POLICY snmp_coleta_worker ON snmp_coleta FOR ALL TO uptimex_worker USING (true) WITH CHECK (true);

ALTER TABLE snmp_recursos_amostras ENABLE ROW LEVEL SECURITY;
ALTER TABLE snmp_recursos_amostras FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS snmp_recursos_read ON snmp_recursos_amostras;
CREATE POLICY snmp_recursos_read ON snmp_recursos_amostras FOR SELECT TO uptimex_app USING (app_is_staff());
DROP POLICY IF EXISTS snmp_recursos_worker ON snmp_recursos_amostras;
CREATE POLICY snmp_recursos_worker ON snmp_recursos_amostras FOR ALL TO uptimex_worker USING (true) WITH CHECK (true);

-- ---- Grants (tabelas novas não herdam o GRANT ON ALL TABLES do init) ---------
GRANT SELECT ON snmp_interfaces, snmp_interface_amostras, snmp_coleta, snmp_recursos_amostras TO uptimex_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON snmp_interfaces, snmp_interface_amostras, snmp_coleta, snmp_recursos_amostras TO uptimex_worker;
