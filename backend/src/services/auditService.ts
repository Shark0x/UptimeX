import { pool, workerQuery } from '../db/pool';

export async function registrarAuditoria(
  usuario: string,
  acao: string,
  entidade: string,
  entidadeId: number | null,
  detalhes: string,
  ipOrigem?: string,
  contexto: { usuarioId?: number | null; empresaId?: number | null } = {}
) {
  await pool.query(
    `INSERT INTO auditoria
       (usuario_id, empresa_id, usuario, acao, entidade, entidade_id, detalhes, ip_origem, pais, regiao, cidade)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      contexto.usuarioId ?? null,
      contexto.empresaId ?? null,
      usuario,
      acao,
      entidade,
      entidadeId,
      detalhes,
      ipOrigem || null,
      null,
      null,
      null,
    ]
  );
}

const DIA_MS = 24 * 60 * 60 * 1000;

async function limparAuditoriaAntiga(): Promise<void> {
  const retencaoDias = Math.min(Math.max(Number(process.env.AUDIT_RETENTION_DAYS) || 365, 30), 3650);
  const retencaoIpDias = Math.min(Math.max(Number(process.env.AUDIT_IP_RETENTION_DAYS) || 90, 1), retencaoDias);
  const corteIp = new Date(Date.now() - retencaoIpDias * DIA_MS);
  const corteEventos = new Date(Date.now() - retencaoDias * DIA_MS);
  const retencaoAntenasDias = Math.min(Math.max(Number(process.env.ANTENNA_METRICS_RETENTION_DAYS) || 30, 1), 365);
  const corteAntenas = new Date(Date.now() - retencaoAntenasDias * DIA_MS);

  for (let lote = 0; lote < 20; lote++) {
    const [, meta] = await workerQuery(
      `UPDATE auditoria SET ip_origem = NULL, pais = NULL, regiao = NULL, cidade = NULL
       WHERE ctid IN (
         SELECT ctid FROM auditoria
         WHERE "timestamp" < ? AND ip_origem IS NOT NULL
         LIMIT 5000
       )`,
      [corteIp]
    );
    if (meta.rowCount < 5000) break;
  }
  for (let lote = 0; lote < 20; lote++) {
    const [, meta] = await workerQuery(
      `DELETE FROM auditoria WHERE ctid IN (
         SELECT ctid FROM auditoria WHERE "timestamp" < ? LIMIT 5000
       )`,
      [corteEventos]
    );
    if (meta.rowCount < 5000) break;
  }
  await workerQuery(`DELETE FROM usuario_sessoes WHERE expires_at < NOW() - INTERVAL '7 days' OR revoked_at < NOW() - INTERVAL '30 days'`);
  for (let lote = 0; lote < 20; lote++) {
    const [, meta] = await workerQuery(
      `DELETE FROM antenas_metricas WHERE ctid IN (
         SELECT ctid FROM antenas_metricas WHERE "timestamp" < ? LIMIT 5000
       )`,
      [corteAntenas]
    );
    if (meta.rowCount < 5000) break;
  }
}

export function iniciarRetencaoAuditoria(): void {
  const executar = () => limparAuditoriaAntiga().catch(() => {
    console.error('Falha na retencao de auditoria.');
  });
  setTimeout(executar, 60 * 60 * 1000).unref();
  setInterval(executar, DIA_MS).unref();
}
