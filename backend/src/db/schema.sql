-- ===================================================
-- NetMonitor - Schema MySQL
-- ===================================================

CREATE TABLE IF NOT EXISTS usuarios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  senha_hash VARCHAR(100) NOT NULL,
  role ENUM('admin','visualizador') NOT NULL DEFAULT 'visualizador',
  ativo BOOLEAN DEFAULT TRUE,
  criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
);

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
  comunidade_snmp VARCHAR(100) DEFAULT 'public',
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

-- Auditoria: quem fez o quê
CREATE TABLE IF NOT EXISTS auditoria (
  id INT AUTO_INCREMENT PRIMARY KEY,
  usuario VARCHAR(100) NOT NULL,
  acao VARCHAR(50) NOT NULL, -- criar, editar, remover, login etc
  entidade VARCHAR(50) NOT NULL, -- empresa, dispositivo, topologia
  entidade_id INT,
  detalhes TEXT,
  ip_origem VARCHAR(45),
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);

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
