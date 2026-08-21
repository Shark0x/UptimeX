import { pool } from '../db/pool';

export type PingHistoryRange = '24h' | '7d' | '30d' | '90d' | '1y';
export type PingHistorySource = 'raw' | 'hourly' | 'daily';

interface RangeConfig {
  source: PingHistorySource;
  table: 'ping_log' | 'ping_log_hourly' | 'ping_log_daily';
  durationMs: number;
  granularity: '5m' | '1h' | '1d';
}

export interface PingHistoryPoint {
  timestamp: string;
  avg_latency: number | null;
  min_latency: number | null;
  max_latency: number | null;
  packet_loss_pct: number;
  uptime_pct: number;
  degraded_pct: number;
}

export const PING_HISTORY_RANGES: Readonly<Record<PingHistoryRange, RangeConfig>> = Object.freeze({
  '24h': { source: 'raw', table: 'ping_log', durationMs: 24 * 60 * 60 * 1_000, granularity: '5m' },
  '7d': { source: 'hourly', table: 'ping_log_hourly', durationMs: 7 * 24 * 60 * 60 * 1_000, granularity: '1h' },
  '30d': { source: 'hourly', table: 'ping_log_hourly', durationMs: 30 * 24 * 60 * 60 * 1_000, granularity: '1h' },
  '90d': { source: 'daily', table: 'ping_log_daily', durationMs: 90 * 24 * 60 * 60 * 1_000, granularity: '1d' },
  '1y': { source: 'daily', table: 'ping_log_daily', durationMs: 365 * 24 * 60 * 60 * 1_000, granularity: '1d' },
});

export function normalizarRangeHistorico(valor: unknown): PingHistoryRange | null {
  const range = String(valor || '24h') as PingHistoryRange;
  return Object.prototype.hasOwnProperty.call(PING_HISTORY_RANGES, range) ? range : null;
}

function numeroOuNull(valor: unknown) {
  if (valor === null || valor === undefined) return null;
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
}

function mapearLinhas(linhas: any[]): PingHistoryPoint[] {
  return linhas.map((linha) => ({
    timestamp: String(linha.timestamp),
    avg_latency: numeroOuNull(linha.avg_latency),
    min_latency: numeroOuNull(linha.min_latency),
    max_latency: numeroOuNull(linha.max_latency),
    packet_loss_pct: Number(linha.packet_loss_pct || 0),
    uptime_pct: Number(linha.uptime_pct || 0),
    degraded_pct: Number(linha.degraded_pct || 0),
  }));
}

async function consultarRaw(
  campoEscopo: 'device_id' | 'empresa_id',
  id: number,
  inicio: Date
): Promise<PingHistoryPoint[]> {
  const [linhas]: any = await pool.query(
    `SELECT
       to_char(bucket_start, 'YYYY-MM-DD"T"HH24:MI:SS') AS timestamp,
       ROUND(avg_latency::numeric, 2) AS avg_latency,
       ROUND(min_latency::numeric, 2) AS min_latency,
       ROUND(max_latency::numeric, 2) AS max_latency,
       ROUND(packet_loss_pct::numeric, 2) AS packet_loss_pct,
       ROUND(uptime_pct::numeric, 2) AS uptime_pct,
       ROUND(degraded_pct::numeric, 2) AS degraded_pct
     FROM (
       SELECT
         to_timestamp(floor(extract(epoch from "timestamp") / 300) * 300) AT TIME ZONE 'UTC' AS bucket_start,
         AVG(latency_ms) AS avg_latency,
         MIN(latency_ms) AS min_latency,
         MAX(latency_ms) AS max_latency,
         AVG(packet_loss) AS packet_loss_pct,
         100.0 * COUNT(*) FILTER (WHERE status <> 'offline') / COUNT(*) AS uptime_pct,
         100.0 * COUNT(*) FILTER (WHERE status = 'degraded') / COUNT(*) AS degraded_pct
       FROM ping_log
       WHERE ${campoEscopo} = ? AND "timestamp" >= ? AND "timestamp" <= NOW()
       GROUP BY 1
     ) buckets
     ORDER BY bucket_start ASC`,
    [id, inicio]
  );
  return mapearLinhas(linhas);
}

async function consultarRollup(
  config: RangeConfig,
  campoEscopo: 'device_id' | 'empresa_id',
  id: number,
  inicio: Date
): Promise<PingHistoryPoint[]> {
  const formatoTimestamp = config.source === 'daily'
    ? `to_char(bucket_start, 'YYYY-MM-DD"T00:00:00"')`
    : `to_char(bucket_start, 'YYYY-MM-DD"T"HH24:MI:SS')`;

  // table/campoEscopo vêm exclusivamente dos mapas tipados acima; valores do
  // cliente continuam em parametros, sem interpolacao de entrada externa.
  const [linhas]: any = await pool.query(
    `SELECT
       ${formatoTimestamp} AS timestamp,
       ROUND((SUM(avg_latency * latency_sample_count) /
         NULLIF(SUM(latency_sample_count), 0))::numeric, 2) AS avg_latency,
       ROUND(MIN(min_latency)::numeric, 2) AS min_latency,
       ROUND(MAX(max_latency)::numeric, 2) AS max_latency,
       ROUND((SUM(packet_loss_pct * sample_count) /
         NULLIF(SUM(sample_count), 0))::numeric, 2) AS packet_loss_pct,
       ROUND((SUM(uptime_pct * sample_count) /
         NULLIF(SUM(sample_count), 0))::numeric, 2) AS uptime_pct,
       ROUND((SUM(degraded_pct * sample_count) /
         NULLIF(SUM(sample_count), 0))::numeric, 2) AS degraded_pct
     FROM ${config.table}
     WHERE ${campoEscopo} = ? AND bucket_start >= ? AND bucket_start <= NOW()
     GROUP BY bucket_start
     ORDER BY bucket_start ASC`,
    [id, inicio]
  );
  return mapearLinhas(linhas);
}

async function consultarHistorico(
  campoEscopo: 'device_id' | 'empresa_id',
  id: number,
  range: PingHistoryRange
) {
  const config = PING_HISTORY_RANGES[range];
  const inicio = new Date(Date.now() - config.durationMs);
  if (config.source === 'raw') return consultarRaw(campoEscopo, id, inicio);
  return consultarRollup(config, campoEscopo, id, inicio);
}

export function consultarHistoricoPingDispositivo(deviceId: number, range: PingHistoryRange) {
  return consultarHistorico('device_id', deviceId, range);
}

export function consultarHistoricoPingEmpresa(empresaId: number, range: PingHistoryRange) {
  return consultarHistorico('empresa_id', empresaId, range);
}
