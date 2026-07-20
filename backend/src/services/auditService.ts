import { pool } from '../db/pool';

export async function registrarAuditoria(
  usuario: string,
  acao: string,
  entidade: string,
  entidadeId: number | null,
  detalhes: string,
  ipOrigem?: string
) {
  await pool.query(
    `INSERT INTO auditoria (usuario, acao, entidade, entidade_id, detalhes, ip_origem)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [usuario, acao, entidade, entidadeId, detalhes, ipOrigem || null]
  );
}
