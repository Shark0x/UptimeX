CREATE TABLE IF NOT EXISTS ping_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  timestamp DATETIME(3) NOT NULL,
  device_id INT NOT NULL,
  empresa_id INT NOT NULL,
  latency_ms DOUBLE NULL,
  packet_loss DOUBLE NOT NULL,
  status ENUM('online', 'offline', 'degraded') NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ping_log_device_timestamp (device_id, timestamp),
  KEY idx_ping_log_empresa_timestamp (empresa_id, timestamp),
  KEY idx_ping_log_timestamp (timestamp),
  CONSTRAINT fk_ping_log_device
    FOREIGN KEY (device_id) REFERENCES dispositivos(id) ON DELETE CASCADE,
  CONSTRAINT fk_ping_log_empresa
    FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS ping_log_hourly (
  device_id INT NOT NULL,
  empresa_id INT NOT NULL,
  bucket_start DATETIME NOT NULL,
  sample_count INT UNSIGNED NOT NULL,
  latency_sample_count INT UNSIGNED NOT NULL,
  avg_latency DOUBLE NULL,
  min_latency DOUBLE NULL,
  max_latency DOUBLE NULL,
  packet_loss_pct DOUBLE NOT NULL,
  uptime_pct DOUBLE NOT NULL,
  degraded_pct DOUBLE NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (device_id, bucket_start),
  KEY idx_ping_log_hourly_empresa_bucket (empresa_id, bucket_start),
  KEY idx_ping_log_hourly_bucket (bucket_start),
  CONSTRAINT fk_ping_log_hourly_device
    FOREIGN KEY (device_id) REFERENCES dispositivos(id) ON DELETE CASCADE,
  CONSTRAINT fk_ping_log_hourly_empresa
    FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS ping_log_daily (
  device_id INT NOT NULL,
  empresa_id INT NOT NULL,
  bucket_start DATE NOT NULL,
  sample_count INT UNSIGNED NOT NULL,
  latency_sample_count INT UNSIGNED NOT NULL,
  avg_latency DOUBLE NULL,
  min_latency DOUBLE NULL,
  max_latency DOUBLE NULL,
  packet_loss_pct DOUBLE NOT NULL,
  uptime_pct DOUBLE NOT NULL,
  degraded_pct DOUBLE NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (device_id, bucket_start),
  KEY idx_ping_log_daily_empresa_bucket (empresa_id, bucket_start),
  KEY idx_ping_log_daily_bucket (bucket_start),
  CONSTRAINT fk_ping_log_daily_device
    FOREIGN KEY (device_id) REFERENCES dispositivos(id) ON DELETE CASCADE,
  CONSTRAINT fk_ping_log_daily_empresa
    FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Preserva o histÃ³rico recente existente. A chave Ãºnica torna o backfill idempotente.
INSERT IGNORE INTO ping_log
  (timestamp, device_id, empresa_id, latency_ms, packet_loss, status)
SELECT
  pm.timestamp,
  pm.dispositivo_id,
  d.empresa_id,
  pm.latencia_ms,
  pm.perda_pct,
  CASE
    WHEN pm.perda_pct >= 100 THEN 'offline'
    WHEN pm.perda_pct >= 2 OR pm.latencia_ms >= 150 THEN 'degraded'
    ELSE 'online'
  END
FROM ping_metricas pm
INNER JOIN dispositivos d ON d.id = pm.dispositivo_id;
