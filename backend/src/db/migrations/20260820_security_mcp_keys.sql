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

-- A credencial antiga era global e reversivel. A migracao a revoga para que o
-- administrador gere outra chave, agora hasheada, expirada e com escopo.
DELETE FROM configuracoes WHERE chave = 'mcp_api_key';

