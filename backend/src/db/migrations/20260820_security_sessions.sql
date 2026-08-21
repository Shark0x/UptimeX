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
  CONSTRAINT fk_usuario_sessoes_usuario
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  INDEX idx_usuario_sessoes_usuario_ativas (usuario_id, revoked_at, expires_at),
  INDEX idx_usuario_sessoes_expiracao (expires_at, revoked_at)
) ENGINE=InnoDB;

