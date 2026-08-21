-- ===================================================
-- NetMonitor - Schema MySQL
-- ===================================================

CREATE TABLE IF NOT EXISTS usuarios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  senha_hash VARCHAR(100) NOT NULL,
  role ENUM('admin','operador','visualizador') NOT NULL DEFAULT 'visualizador',
  ativo BOOLEAN DEFAULT TRUE,
  sessao_versao INT NOT NULL DEFAULT 1,
  criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS usuario_sessoes (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  usuario_id INT NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  sessao_versao INT NOT NULL,
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME NULL,
  last_used_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ip_origem VARCHAR(45) NULL,
  user_agent VARCHAR(255) NULL,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  INDEX idx_usuario_sessoes_usuario_ativas (usuario_id, revoked_at, expires_at),
  INDEX idx_usuario_sessoes_expiracao (expires_at, revoked_at)
) ENGINE=InnoDB;

-- Expande papéis e adiciona revogação de sessão em instalações existentes.
ALTER TABLE usuarios MODIFY COLUMN role ENUM('admin','operador','visualizador') NOT NULL DEFAULT 'visualizador';

SET @colSessao := (SELECT COUNT(1) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'usuarios' AND column_name = 'sessao_versao');
SET @sqlSessao := IF(@colSessao = 0,
  'ALTER TABLE usuarios ADD COLUMN sessao_versao INT NOT NULL DEFAULT 1',
  'SELECT 1');
PREPARE stmtSessao FROM @sqlSessao;
EXECUTE stmtSessao;
DEALLOCATE PREPARE stmtSessao;

-- Avatar do perfil do usuário (upload no servidor, mesmo padrão da foto de empresa).
SET @colAvatar := (SELECT COUNT(1) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'usuarios' AND column_name = 'avatar_url');
SET @sqlAvatar := IF(@colAvatar = 0,
  'ALTER TABLE usuarios ADD COLUMN avatar_url VARCHAR(255) NULL',
  'SELECT 1');
PREPARE stmtAvatar FROM @sqlAvatar;
EXECUTE stmtAvatar;
DEALLOCATE PREPARE stmtAvatar;

CREATE TABLE IF NOT EXISTS empresas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(150) NOT NULL,
  descricao VARCHAR(255),
  foto_url VARCHAR(255) NULL,
  endereco VARCHAR(255) NULL,
  latitude DOUBLE NULL,
  longitude DOUBLE NULL,
  criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- O marcador precisa ser capturado antes do CREATE para que o backfill abaixo
-- aconteça somente na primeira migração. Reexecuções nunca reativam vínculos.
SET @usuarioEmpresasExistia := (SELECT COUNT(1) FROM information_schema.tables
  WHERE table_schema = DATABASE() AND table_name = 'usuario_empresas');

CREATE TABLE IF NOT EXISTS usuario_empresas (
  usuario_id INT NOT NULL,
  empresa_id INT NOT NULL,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (usuario_id, empresa_id),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  INDEX idx_usuario_empresas_empresa (empresa_id, usuario_id, ativo)
);

-- Preserva o acesso dos visualizadores existentes na migração inicial. Contas
-- criadas daqui em diante recebem apenas os vínculos escolhidos pelo admin.
SET @sqlBackfillVinculos := IF(@usuarioEmpresasExistia = 0,
  'INSERT INTO usuario_empresas (usuario_id, empresa_id, ativo) SELECT u.id, e.id, TRUE FROM usuarios u CROSS JOIN empresas e WHERE u.role <> ''admin''',
  'SELECT 1');
PREPARE stmtBackfillVinculos FROM @sqlBackfillVinculos;
EXECUTE stmtBackfillVinculos;
DEALLOCATE PREPARE stmtBackfillVinculos;

-- MySQL não suporta "ADD COLUMN IF NOT EXISTS" (isso é sintaxe do MariaDB),
-- então checamos via information_schema pra rodar em bancos já migrados sem erro.
SET @col1 := (SELECT COUNT(1) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'empresas' AND column_name = 'foto_url');
SET @sql0 := IF(@col1 = 0, 'ALTER TABLE empresas ADD COLUMN foto_url VARCHAR(255) NULL', 'SELECT 1');
PREPARE stmt0 FROM @sql0;
EXECUTE stmt0;
DEALLOCATE PREPARE stmt0;

-- Endereço + coordenadas da sede (marcador no globo do dashboard)
SET @colEnd := (SELECT COUNT(1) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'empresas' AND column_name = 'endereco');
SET @sqlEnd := IF(@colEnd = 0,
  'ALTER TABLE empresas ADD COLUMN endereco VARCHAR(255) NULL, ADD COLUMN latitude DOUBLE NULL, ADD COLUMN longitude DOUBLE NULL',
  'SELECT 1');
PREPARE stmtEnd FROM @sqlEnd;
EXECUTE stmtEnd;
DEALLOCATE PREPARE stmtEnd;

CREATE TABLE IF NOT EXISTS dispositivos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  nome VARCHAR(150) NOT NULL,
  ip VARCHAR(45) NOT NULL,
  fabricante VARCHAR(50) DEFAULT 'generico', -- mikrotik, ubiquiti, cisco, generico
  metodo_monitoramento ENUM('snmp', 'ping', 'snmp+ping') DEFAULT 'snmp+ping',
  comunidade_snmp VARCHAR(500) NULL DEFAULT NULL,
  porta_snmp INT DEFAULT 161,
  intervalo_polling_seg INT DEFAULT 30,
  status_atual ENUM('online','offline','desconhecido') DEFAULT 'desconhecido',
  ultima_verificacao DATETIME NULL,
  ativo BOOLEAN DEFAULT TRUE,
  criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
);

-- Latência/perda atuais ficam denormalizadas no dispositivo pro painel não precisar
-- agregar a tabela de métricas a cada heartbeat.
SET @col2 := (SELECT COUNT(1) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'dispositivos' AND column_name = 'latencia_ms');
SET @sqlA := IF(@col2 = 0, 'ALTER TABLE dispositivos ADD COLUMN latencia_ms FLOAT NULL', 'SELECT 1');
PREPARE stmtA FROM @sqlA;
EXECUTE stmtA;
DEALLOCATE PREPARE stmtA;

SET @col3 := (SELECT COUNT(1) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'dispositivos' AND column_name = 'perda_pct');
SET @sqlB := IF(@col3 = 0, 'ALTER TABLE dispositivos ADD COLUMN perda_pct FLOAT NULL', 'SELECT 1');
PREPARE stmtB FROM @sqlB;
EXECUTE stmtB;
DEALLOCATE PREPARE stmtB;

-- Amostras de ping por ciclo de verificação (gráficos de latência e perda de pacotes).
-- latencia_ms NULL = dispositivo não respondeu nenhum echo (queda total).
CREATE TABLE IF NOT EXISTS ping_metricas (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  dispositivo_id INT NOT NULL,
  latencia_ms FLOAT NULL,
  perda_pct FLOAT NOT NULL DEFAULT 0,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (dispositivo_id) REFERENCES dispositivos(id) ON DELETE CASCADE
);

-- Histórico de eventos de status (pra calcular tempo de queda)
CREATE TABLE IF NOT EXISTS status_eventos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  dispositivo_id INT NOT NULL,
  status ENUM('online','offline') NOT NULL,
  inicio DATETIME NOT NULL,
  fim DATETIME NULL, -- NULL enquanto o evento está em aberto (ainda no mesmo estado)
  duracao_segundos INT NULL,
  FOREIGN KEY (dispositivo_id) REFERENCES dispositivos(id) ON DELETE CASCADE
);

-- Nós do diagrama de topologia (posição visual no canvas)
CREATE TABLE IF NOT EXISTS topologia_nodes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  dispositivo_id INT NULL, -- pode ser NULL se for um nó "decorativo" (ex: nuvem/internet)
  label VARCHAR(150) NOT NULL,
  tipo VARCHAR(30) DEFAULT 'outro',
  pos_x FLOAT DEFAULT 0,
  pos_y FLOAT DEFAULT 0,
  FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  FOREIGN KEY (dispositivo_id) REFERENCES dispositivos(id) ON DELETE SET NULL
);

-- Bancos criados antes da expansão de tipos (firewall, datacenter, olt, onu, backbone,
-- cliente, pop...) tinham ENUM aqui; VARCHAR aceita os valores antigos sem conversão.
ALTER TABLE topologia_nodes MODIFY COLUMN tipo VARCHAR(30) DEFAULT 'outro';

-- Enquadramento (pan/zoom) salvo da topologia de cada empresa — o layout que o
-- operador deixou vale em qualquer navegador/aparelho, não só no localStorage.
CREATE TABLE IF NOT EXISTS topologia_viewport (
  empresa_id INT PRIMARY KEY,
  pos_x FLOAT NOT NULL DEFAULT 0,
  pos_y FLOAT NOT NULL DEFAULT 0,
  zoom FLOAT NOT NULL DEFAULT 1,
  FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS topologia_edges (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  node_origem INT NOT NULL,
  node_destino INT NOT NULL,
  label VARCHAR(100),
  FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  FOREIGN KEY (node_origem) REFERENCES topologia_nodes(id) ON DELETE CASCADE,
  FOREIGN KEY (node_destino) REFERENCES topologia_nodes(id) ON DELETE CASCADE
);

-- Blocos de IP dedicados entregues ao cliente (aba Link Dedicado da empresa).
-- O cálculo de rede/broadcast/hosts é feito no frontend a partir do bloco CIDR.
CREATE TABLE IF NOT EXISTS links_dedicados (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  bloco VARCHAR(45) NOT NULL, -- ex: 45.174.147.128/30
  descricao VARCHAR(255) NULL,
  criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
);

-- Configurações editáveis pela interface (ex: token/chat do Telegram, anti-ruído)
CREATE TABLE IF NOT EXISTS configuracoes (
  chave VARCHAR(60) PRIMARY KEY,
  valor TEXT
);

CREATE TABLE IF NOT EXISTS mcp_api_keys (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  token_hash CHAR(64) NOT NULL UNIQUE,
  token_prefix VARCHAR(24) NOT NULL,
  empresa_id INT NULL,
  escopo_global BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at DATETIME NOT NULL,
  last_used_at DATETIME NULL,
  revoked_at DATETIME NULL,
  criada_por INT NULL,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  FOREIGN KEY (criada_por) REFERENCES usuarios(id) ON DELETE SET NULL,
  INDEX idx_mcp_api_keys_ativas (token_hash, revoked_at, expires_at),
  INDEX idx_mcp_api_keys_empresa (empresa_id, revoked_at)
) ENGINE=InnoDB;

-- Auditoria: quem fez o quê
CREATE TABLE IF NOT EXISTS auditoria (
  id INT AUTO_INCREMENT PRIMARY KEY,
  usuario_id INT NULL,
  empresa_id INT NULL,
  usuario VARCHAR(100) NOT NULL,
  acao VARCHAR(50) NOT NULL, -- criar, editar, remover, login, login_falhou etc
  entidade VARCHAR(50) NOT NULL, -- empresa, dispositivo, topologia
  entidade_id INT,
  detalhes TEXT,
  ip_origem VARCHAR(45),
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);

SET @colAuditUsuario := (SELECT COUNT(1) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'auditoria' AND column_name = 'usuario_id');
SET @sqlAuditUsuario := IF(@colAuditUsuario = 0,
  'ALTER TABLE auditoria ADD COLUMN usuario_id INT NULL AFTER id',
  'SELECT 1');
PREPARE stmtAuditUsuario FROM @sqlAuditUsuario;
EXECUTE stmtAuditUsuario;
DEALLOCATE PREPARE stmtAuditUsuario;

SET @colAuditEmpresa := (SELECT COUNT(1) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'auditoria' AND column_name = 'empresa_id');
SET @sqlAuditEmpresa := IF(@colAuditEmpresa = 0,
  'ALTER TABLE auditoria ADD COLUMN empresa_id INT NULL AFTER usuario_id',
  'SELECT 1');
PREPARE stmtAuditEmpresa FROM @sqlAuditEmpresa;
EXECUTE stmtAuditEmpresa;
DEALLOCATE PREPARE stmtAuditEmpresa;

-- Localização aproximada do IP de origem (login e tentativas de login), pra dar
-- visibilidade de segurança sobre quem acessou o sistema e de onde.
SET @colGeo := (SELECT COUNT(1) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'auditoria' AND column_name = 'pais');
SET @sqlGeo := IF(@colGeo = 0,
  'ALTER TABLE auditoria ADD COLUMN pais VARCHAR(5) NULL, ADD COLUMN regiao VARCHAR(10) NULL, ADD COLUMN cidade VARCHAR(100) NULL',
  'SELECT 1');
PREPARE stmtGeo FROM @sqlGeo;
EXECUTE stmtGeo;
DEALLOCATE PREPARE stmtGeo;

-- CREATE INDEX não tem "IF NOT EXISTS" no MySQL, então checamos via information_schema
-- pra esse arquivo poder ser reexecutado sem erro em bancos já migrados.
SET @idx1 := (SELECT COUNT(1) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'status_eventos' AND index_name = 'idx_status_eventos_dispositivo');
SET @sql1 := IF(@idx1 = 0, 'CREATE INDEX idx_status_eventos_dispositivo ON status_eventos(dispositivo_id, inicio)', 'SELECT 1');
PREPARE stmt1 FROM @sql1;
EXECUTE stmt1;
DEALLOCATE PREPARE stmt1;

SET @idx2 := (SELECT COUNT(1) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'dispositivos' AND index_name = 'idx_dispositivos_empresa');
SET @sql2 := IF(@idx2 = 0, 'CREATE INDEX idx_dispositivos_empresa ON dispositivos(empresa_id)', 'SELECT 1');
PREPARE stmt2 FROM @sql2;
EXECUTE stmt2;
DEALLOCATE PREPARE stmt2;

SET @idx3 := (SELECT COUNT(1) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'ping_metricas' AND index_name = 'idx_ping_metricas_disp');
SET @sql3 := IF(@idx3 = 0, 'CREATE INDEX idx_ping_metricas_disp ON ping_metricas(dispositivo_id, timestamp)', 'SELECT 1');
PREPARE stmt3 FROM @sql3;
EXECUTE stmt3;
DEALLOCATE PREPARE stmt3;

SET @idxAuditEmpresa := (SELECT COUNT(1) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'auditoria' AND index_name = 'idx_auditoria_empresa');
SET @sqlIdxAuditEmpresa := IF(@idxAuditEmpresa = 0,
  'CREATE INDEX idx_auditoria_empresa ON auditoria(empresa_id, timestamp)',
  'SELECT 1');
PREPARE stmtIdxAuditEmpresa FROM @sqlIdxAuditEmpresa;
EXECUTE stmtIdxAuditEmpresa;
DEALLOCATE PREPARE stmtIdxAuditEmpresa;

-- ===================================================
-- Modulo Antenas: Monitoramento Wireless & Topologia de Enlaces
-- ===================================================

CREATE TABLE IF NOT EXISTS antenas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(150) NOT NULL,
  ip VARCHAR(45) NOT NULL,
  fabricante VARCHAR(50) DEFAULT 'ubiquiti', -- ubiquiti, mikrotik, mimosa, intelbras, cambium, cisco, outro
  modelo VARCHAR(100) NULL,
  tipo_wireless VARCHAR(50) DEFAULT 'ptp_master', -- ptp_master, ptp_slave, ptmp_ap, ptmp_station, torre, switch_torre, repetidora, outro
  frequencia_mhz INT NULL,
  largura_canal_mhz INT NULL,
  ssid VARCHAR(100) NULL,
  sinal_esperado_dbm INT NULL,
  intervalo_polling_seg INT DEFAULT 10,
  status_atual ENUM('online','offline','desconhecido') DEFAULT 'desconhecido',
  latencia_ms FLOAT NULL,
  perda_pct FLOAT NULL,
  ultima_verificacao DATETIME NULL,
  ativo BOOLEAN DEFAULT TRUE,
  criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS antenas_nodes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  antena_id INT NULL,
  label VARCHAR(150) NOT NULL,
  tipo_visual VARCHAR(50) DEFAULT 'antena_ptp', -- antena_ptp, antena_setorial, torre, antena_cpe, switch_poe, router, outro
  pos_x FLOAT DEFAULT 0,
  pos_y FLOAT DEFAULT 0,
  criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (antena_id) REFERENCES antenas(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS antenas_enlaces (
  id INT AUTO_INCREMENT PRIMARY KEY,
  origem_node_id INT NOT NULL,
  destino_node_id INT NOT NULL,
  tipo_enlace VARCHAR(50) DEFAULT 'ptp_wireless', -- ptp_wireless, ptmp_wireless, cabo_poe, fibra_torre, backup_radio
  label VARCHAR(100) NULL,
  frequencia VARCHAR(50) NULL,
  distancia_km FLOAT NULL,
  capacidade_mbps INT NULL,
  criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (origem_node_id) REFERENCES antenas_nodes(id) ON DELETE CASCADE,
  FOREIGN KEY (destino_node_id) REFERENCES antenas_nodes(id) ON DELETE CASCADE
);

-- Customização visual do enlace (cor em hex e reta/curva), editável pelo usuário no
-- painel de topologia. NULL/0 preserva o visual automático de instalações antigas.
SET @colAntiCor := (SELECT COUNT(1) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'antenas_enlaces' AND column_name = 'cor');
SET @sqlAntiCor := IF(@colAntiCor = 0, 'ALTER TABLE antenas_enlaces ADD COLUMN cor VARCHAR(20) NULL DEFAULT NULL', 'SELECT 1');
PREPARE stmtAntiCor FROM @sqlAntiCor;
EXECUTE stmtAntiCor;
DEALLOCATE PREPARE stmtAntiCor;

SET @colAntiCurvo := (SELECT COUNT(1) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'antenas_enlaces' AND column_name = 'curvo');
SET @sqlAntiCurvo := IF(@colAntiCurvo = 0, 'ALTER TABLE antenas_enlaces ADD COLUMN curvo TINYINT(1) NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE stmtAntiCurvo FROM @sqlAntiCurvo;
EXECUTE stmtAntiCurvo;
DEALLOCATE PREPARE stmtAntiCurvo;

-- Mais customização visual da linha: espessura (px), estilo do traço e fluxo animado.
-- NULL = usa o comportamento automático atual (compatível com enlaces antigos).
SET @colAntiEsp := (SELECT COUNT(1) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'antenas_enlaces' AND column_name = 'espessura');
SET @sqlAntiEsp := IF(@colAntiEsp = 0, 'ALTER TABLE antenas_enlaces ADD COLUMN espessura FLOAT NULL DEFAULT NULL', 'SELECT 1');
PREPARE stmtAntiEsp FROM @sqlAntiEsp;
EXECUTE stmtAntiEsp;
DEALLOCATE PREPARE stmtAntiEsp;

SET @colAntiEstilo := (SELECT COUNT(1) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'antenas_enlaces' AND column_name = 'estilo');
SET @sqlAntiEstilo := IF(@colAntiEstilo = 0, 'ALTER TABLE antenas_enlaces ADD COLUMN estilo VARCHAR(20) NULL DEFAULT NULL', 'SELECT 1');
PREPARE stmtAntiEstilo FROM @sqlAntiEstilo;
EXECUTE stmtAntiEstilo;
DEALLOCATE PREPARE stmtAntiEstilo;

SET @colAntiAnim := (SELECT COUNT(1) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'antenas_enlaces' AND column_name = 'animado');
SET @sqlAntiAnim := IF(@colAntiAnim = 0, 'ALTER TABLE antenas_enlaces ADD COLUMN animado TINYINT(1) NULL DEFAULT NULL', 'SELECT 1');
PREPARE stmtAntiAnim FROM @sqlAntiAnim;
EXECUTE stmtAntiAnim;
DEALLOCATE PREPARE stmtAntiAnim;

-- Board único (não é por empresa): enquadramento salvo do mapa de antenas,
-- pensado pra ficar aberto numa tela/TV do NOC observando tudo junto.
CREATE TABLE IF NOT EXISTS antenas_viewport (
  id INT PRIMARY KEY DEFAULT 1,
  pos_x FLOAT NOT NULL DEFAULT 0,
  pos_y FLOAT NOT NULL DEFAULT 0,
  zoom FLOAT NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS antenas_metricas (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  antena_id INT NOT NULL,
  latencia_ms FLOAT NULL,
  perda_pct FLOAT NOT NULL DEFAULT 0,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (antena_id) REFERENCES antenas(id) ON DELETE CASCADE
);

SET @idxAnti1 := (SELECT COUNT(1) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'antenas_metricas' AND index_name = 'idx_antenas_metricas_antena');
SET @sqlAnti1 := IF(@idxAnti1 = 0, 'CREATE INDEX idx_antenas_metricas_antena ON antenas_metricas(antena_id, timestamp)', 'SELECT 1');
PREPARE stmtAnti1 FROM @sqlAnti1;
EXECUTE stmtAnti1;
DEALLOCATE PREPARE stmtAnti1;
