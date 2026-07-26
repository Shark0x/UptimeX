import { pool } from '../db/pool';
import { localizarIp } from './geoService';

export async function registrarAuditoria(
  usuario: string,
  acao: string,
  entidade: string,
  entidadeId: number | null,
  detalhes: string,
  ipOrigem?: string
) {
  const { pais, regiao, cidade } = localizarIp(ipOrigem);
  await pool.query(
    `INSERT INTO auditoria (usuario, acao, entidade, entidade_id, detalhes, ip_origem, pais, regiao, cidade)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [usuario, acao, entidade, entidadeId, detalhes, ipOrigem || null, pais, regiao, cidade]
  );
}
