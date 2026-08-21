import crypto from 'crypto';
import { pool } from '../db/pool';

export interface McpScope {
  global: boolean;
  empresaIds: number[];
  keyId: number;
}

function hashKey(chave: string): string {
  return crypto.createHash('sha256').update(chave).digest('hex');
}

export async function criarChaveMcp(params: {
  empresaId?: number | null;
  global: boolean;
  expiresDays: number;
  criadaPor: number;
}): Promise<string> {
  const chave = `utmx_mcp_${crypto.randomBytes(32).toString('base64url')}`;
  const prefixo = chave.slice(0, 18);
  const expiraEm = new Date(Date.now() + params.expiresDays * 24 * 60 * 60 * 1000);

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    // A interface gerencia uma chave ativa por vez. Revogar antes de criar evita
    // credenciais esquecidas continuarem funcionando sem aparecer no painel.
    await connection.query(`UPDATE mcp_api_keys SET revoked_at = COALESCE(revoked_at, NOW()) WHERE revoked_at IS NULL`);
    await connection.query(
      `INSERT INTO mcp_api_keys
        (token_hash, token_prefix, empresa_id, escopo_global, expires_at, criada_por)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [hashKey(chave), prefixo, params.global ? null : params.empresaId, params.global, expiraEm, params.criadaPor]
    );
    await connection.commit();
    return chave;
  } catch (erro) {
    await connection.rollback();
    throw erro;
  } finally {
    connection.release();
  }
}

export async function autenticarChaveMcp(chave: string): Promise<McpScope | null> {
  if (!chave.startsWith('utmx_mcp_') || chave.length > 200) return null;
  const [rows]: any = await pool.query(
    `SELECT id, empresa_id, escopo_global
     FROM mcp_api_keys
     WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > NOW()
     LIMIT 1`,
    [hashKey(chave)]
  );
  const registro = rows[0];
  if (!registro) return null;
  void pool.query(`UPDATE mcp_api_keys SET last_used_at = NOW() WHERE id = ?`, [registro.id]).catch(() => undefined);
  return {
    global: Boolean(registro.escopo_global),
    empresaIds: registro.empresa_id == null ? [] : [Number(registro.empresa_id)],
    keyId: Number(registro.id),
  };
}

export async function statusChavesMcp(): Promise<{ ativas: number; global: boolean; empresaId: number | null; expiresAt: string | null }> {
  const [rows]: any = await pool.query(
    `SELECT empresa_id, escopo_global, expires_at
     FROM mcp_api_keys
     WHERE revoked_at IS NULL AND expires_at > NOW()
     ORDER BY criado_em DESC LIMIT 1`
  );
  const item = rows[0];
  return {
    ativas: item ? 1 : 0,
    global: Boolean(item?.escopo_global),
    empresaId: item?.empresa_id == null ? null : Number(item.empresa_id),
    expiresAt: item?.expires_at ?? null,
  };
}

export async function revogarChavesMcp(): Promise<void> {
  await pool.query(`UPDATE mcp_api_keys SET revoked_at = COALESCE(revoked_at, NOW()) WHERE revoked_at IS NULL`);
}

