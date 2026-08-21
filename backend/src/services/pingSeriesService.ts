import { workerQuery } from '../db/pool';

export type PingSampleStatus = 'online' | 'offline' | 'degraded';

export interface PingSample {
  timestamp: Date;
  deviceId: number;
  empresaId: number;
  latencyMs: number | null;
  packetLoss: number;
  status: PingSampleStatus;
}

function numeroAmbiente(nome: string, padrao: number, minimo: number, maximo: number) {
  const valor = Number(process.env[nome]);
  if (!Number.isFinite(valor)) return padrao;
  return Math.min(maximo, Math.max(minimo, Math.trunc(valor)));
}

export const pingSeriesConfig = Object.freeze({
  batchSize: numeroAmbiente('PING_LOG_BATCH_SIZE', 250, 10, 2_000),
  flushMs: numeroAmbiente('PING_LOG_FLUSH_MS', 5_000, 1_000, 60_000),
  maxQueueSize: numeroAmbiente('PING_LOG_MAX_QUEUE_SIZE', 20_000, 1_000, 200_000),
  rawRetentionDays: numeroAmbiente('PING_RAW_RETENTION_DAYS', 15, 2, 365),
  hourlyRetentionMonths: numeroAmbiente('PING_HOURLY_RETENTION_MONTHS', 12, 1, 120),
  dailyRetentionYears: numeroAmbiente('PING_DAILY_RETENTION_YEARS', 0, 0, 100),
  catchupHours: numeroAmbiente('PING_ROLLUP_CATCHUP_HOURS', 48, 2, 24 * 30),
  pruneBatchSize: numeroAmbiente('PING_PRUNE_BATCH_SIZE', 10_000, 500, 50_000),
  degradedLatencyMs: numeroAmbiente('PING_DEGRADED_LATENCY_MS', 150, 1, 60_000),
  degradedPacketLossPct: numeroAmbiente('PING_DEGRADED_PACKET_LOSS_PCT', 2, 1, 100),
});

const fila: PingSample[] = [];
let flushEmAndamento: Promise<void> | null = null;
let timerFlush: NodeJS.Timeout | null = null;
let timerAgendador: NodeJS.Timeout | null = null;
let servicoIniciado = false;
let ultimaHoraAgregada = '';
let ultimoDiaAgregado = '';
let ultimoDiaPrune = '';
let agendadorExecutando = false;

export function classificarAmostraPing(
  online: boolean,
  latencyMs: number | null,
  packetLoss: number
): PingSampleStatus {
  if (!online || packetLoss >= 100) return 'offline';
  if (
    packetLoss >= pingSeriesConfig.degradedPacketLossPct ||
    (latencyMs !== null && latencyMs >= pingSeriesConfig.degradedLatencyMs)
  ) {
    return 'degraded';
  }
  return 'online';
}

/**
 * Apenas enfileira a amostra em memoria. O ciclo de polling nao espera pelo banco
 * de historico; o flush agrupa centenas de amostras em uma unica insercao.
 */
export function enfileirarAmostraPing(amostra: PingSample) {
  if (fila.length >= pingSeriesConfig.maxQueueSize) {
    const descartadas = fila.length - pingSeriesConfig.maxQueueSize + 1;
    fila.splice(0, descartadas);
    console.error(`Fila de ping cheia; ${descartadas} amostra(s) antiga(s) foram descartadas.`);
  }
  fila.push(amostra);
  if (fila.length >= pingSeriesConfig.batchSize) void flushPingLog();
}

export function tamanhoFilaPing() {
  return fila.length;
}

export async function flushPingLog(): Promise<void> {
  if (flushEmAndamento) return flushEmAndamento;
  if (fila.length === 0) return;

  const lote = fila.splice(0, pingSeriesConfig.batchSize);
  flushEmAndamento = (async () => {
    const placeholders = lote.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
    const parametros = lote.flatMap((amostra) => [
      amostra.timestamp,
      amostra.deviceId,
      amostra.empresaId,
      amostra.latencyMs,
      amostra.packetLoss,
      amostra.status,
    ]);

    try {
      await workerQuery(
        `INSERT INTO ping_log
          ("timestamp", device_id, empresa_id, latency_ms, packet_loss, status)
         VALUES ${placeholders}
         ON CONFLICT (device_id, "timestamp") DO UPDATE SET
           empresa_id = EXCLUDED.empresa_id,
           latency_ms = EXCLUDED.latency_ms,
           packet_loss = EXCLUDED.packet_loss,
           status = EXCLUDED.status`,
        parametros
      );
    } catch (erro) {
      const espaco = Math.max(0, pingSeriesConfig.maxQueueSize - fila.length);
      fila.unshift(...lote.slice(Math.max(0, lote.length - espaco)));
      console.error('Erro ao persistir lote de ping; amostras voltaram para a fila:', erro);
    } finally {
      flushEmAndamento = null;
    }
  })();

  return flushEmAndamento;
}

function inicioHora(data: Date) {
  const valor = new Date(data);
  valor.setMinutes(0, 0, 0);
  return valor;
}

function inicioDia(data: Date) {
  const valor = new Date(data);
  valor.setHours(0, 0, 0, 0);
  return valor;
}

function chaveHora(data: Date) {
  return `${data.getFullYear()}-${data.getMonth() + 1}-${data.getDate()}-${data.getHours()}`;
}

function chaveDia(data: Date) {
  return `${data.getFullYear()}-${data.getMonth() + 1}-${data.getDate()}`;
}

export async function agregarPingHourly(inicio: Date, fim: Date) {
  await workerQuery(
    `INSERT INTO ping_log_hourly
      (device_id, empresa_id, bucket_start, sample_count, latency_sample_count,
       avg_latency, min_latency, max_latency, packet_loss_pct, uptime_pct, degraded_pct)
     SELECT
       device_id,
       empresa_id,
       date_trunc('hour', "timestamp") AS bucket_start,
       COUNT(*) AS sample_count,
       COUNT(latency_ms) AS latency_sample_count,
       AVG(latency_ms) AS avg_latency,
       MIN(latency_ms) AS min_latency,
       MAX(latency_ms) AS max_latency,
       AVG(packet_loss) AS packet_loss_pct,
       100.0 * COUNT(*) FILTER (WHERE status <> 'offline') / COUNT(*) AS uptime_pct,
       100.0 * COUNT(*) FILTER (WHERE status = 'degraded') / COUNT(*) AS degraded_pct
     FROM ping_log
     WHERE "timestamp" >= ? AND "timestamp" < ?
     GROUP BY device_id, empresa_id, date_trunc('hour', "timestamp")
     ON CONFLICT (device_id, bucket_start) DO UPDATE SET
       empresa_id = EXCLUDED.empresa_id,
       sample_count = EXCLUDED.sample_count,
       latency_sample_count = EXCLUDED.latency_sample_count,
       avg_latency = EXCLUDED.avg_latency,
       min_latency = EXCLUDED.min_latency,
       max_latency = EXCLUDED.max_latency,
       packet_loss_pct = EXCLUDED.packet_loss_pct,
       uptime_pct = EXCLUDED.uptime_pct,
       degraded_pct = EXCLUDED.degraded_pct,
       updated_at = now()`,
    [inicio, fim]
  );
}

export async function agregarPingDaily(inicio: Date, fim: Date) {
  await workerQuery(
    `INSERT INTO ping_log_daily
      (device_id, empresa_id, bucket_start, sample_count, latency_sample_count,
       avg_latency, min_latency, max_latency, packet_loss_pct, uptime_pct, degraded_pct)
     SELECT
       device_id,
       empresa_id,
       bucket_start::date AS bucket_start,
       SUM(sample_count) AS sample_count,
       SUM(latency_sample_count) AS latency_sample_count,
       SUM(avg_latency * latency_sample_count) / NULLIF(SUM(latency_sample_count), 0) AS avg_latency,
       MIN(min_latency) AS min_latency,
       MAX(max_latency) AS max_latency,
       SUM(packet_loss_pct * sample_count) / NULLIF(SUM(sample_count), 0) AS packet_loss_pct,
       SUM(uptime_pct * sample_count) / NULLIF(SUM(sample_count), 0) AS uptime_pct,
       SUM(degraded_pct * sample_count) / NULLIF(SUM(sample_count), 0) AS degraded_pct
     FROM ping_log_hourly
     WHERE bucket_start >= ? AND bucket_start < ?
     GROUP BY device_id, empresa_id, bucket_start::date
     ON CONFLICT (device_id, bucket_start) DO UPDATE SET
       empresa_id = EXCLUDED.empresa_id,
       sample_count = EXCLUDED.sample_count,
       latency_sample_count = EXCLUDED.latency_sample_count,
       avg_latency = EXCLUDED.avg_latency,
       min_latency = EXCLUDED.min_latency,
       max_latency = EXCLUDED.max_latency,
       packet_loss_pct = EXCLUDED.packet_loss_pct,
       uptime_pct = EXCLUDED.uptime_pct,
       degraded_pct = EXCLUDED.degraded_pct,
       updated_at = now()`,
    [inicio, fim]
  );
}

async function apagarEmLotes(tabela: string, coluna: string, limite: Date) {
  let removidas = 0;
  do {
    // Postgres nao aceita LIMIT em DELETE; delimitamos o lote por ctid.
    const [, meta] = await workerQuery(
      `DELETE FROM ${tabela}
        WHERE ctid IN (
          SELECT ctid FROM ${tabela} WHERE "${coluna}" < ? ORDER BY "${coluna}" LIMIT ?
        )`,
      [limite, pingSeriesConfig.pruneBatchSize]
    );
    removidas = meta.rowCount;
  } while (removidas === pingSeriesConfig.pruneBatchSize);
}

export async function executarPrunePing(referencia = new Date()) {
  const limiteRaw = new Date(referencia);
  limiteRaw.setDate(limiteRaw.getDate() - pingSeriesConfig.rawRetentionDays);
  await apagarEmLotes('ping_log', 'timestamp', limiteRaw);

  const limiteHourly = new Date(referencia);
  limiteHourly.setMonth(limiteHourly.getMonth() - pingSeriesConfig.hourlyRetentionMonths);
  await apagarEmLotes('ping_log_hourly', 'bucket_start', limiteHourly);

  if (pingSeriesConfig.dailyRetentionYears > 0) {
    const limiteDaily = new Date(referencia);
    limiteDaily.setFullYear(limiteDaily.getFullYear() - pingSeriesConfig.dailyRetentionYears);
    await apagarEmLotes('ping_log_daily', 'bucket_start', limiteDaily);
  }
}

export async function verificarIndicesSeriesTemporais() {
  // Conjuntos de colunas (na ordem) que precisam estar cobertos por algum indice.
  // Nao dependemos do NOME do indice: o Postgres nomeia PK/unique automaticamente.
  const esperados: Record<string, string[]> = {
    ping_log: ['device_id,timestamp', 'empresa_id,timestamp'],
    ping_log_hourly: ['device_id,bucket_start', 'empresa_id,bucket_start'],
    ping_log_daily: ['device_id,bucket_start', 'empresa_id,bucket_start'],
  };
  // As colunas da propria relacao do indice (attrelid = oid do indice), em ordem
  // de attnum, correspondem as colunas indexadas na ordem da chave.
  const [linhas]: any = await workerQuery(
    `SELECT t.relname AS tabela,
            string_agg(a.attname, ',' ORDER BY a.attnum) AS colunas
       FROM pg_index ix
       JOIN pg_class i ON i.oid = ix.indexrelid
       JOIN pg_class t ON t.oid = ix.indrelid
       JOIN pg_attribute a ON a.attrelid = i.oid AND a.attnum > 0
      WHERE t.relnamespace = 'public'::regnamespace
        AND t.relname IN ('ping_log', 'ping_log_hourly', 'ping_log_daily')
      GROUP BY t.relname, i.relname`
  );
  const cobertura = new Map<string, Set<string>>();
  for (const linha of linhas as Array<{ tabela: string; colunas: string }>) {
    if (!cobertura.has(linha.tabela)) cobertura.set(linha.tabela, new Set());
    cobertura.get(linha.tabela)!.add(linha.colunas);
  }
  const ausentes = Object.entries(esperados).flatMap(([tabela, combos]) =>
    combos
      .filter((combo) => !cobertura.get(tabela)?.has(combo))
      .map((combo) => `${tabela}(${combo})`)
  );
  if (ausentes.length > 0) {
    throw new Error(`Indices de series temporais ausentes: ${ausentes.join(', ')}`);
  }
  console.log('Indices de series temporais verificados para device/range e empresa/range.');
}

async function executarCatchupInicial() {
  try {
    await flushPingLog();
    const agora = new Date();
    const fimHora = inicioHora(agora);
    const inicioCatchup = new Date(fimHora);
    inicioCatchup.setHours(inicioCatchup.getHours() - pingSeriesConfig.catchupHours);
    await agregarPingHourly(inicioCatchup, fimHora);

    const fimDia = inicioDia(agora);
    const inicioDaily = new Date(fimDia);
    inicioDaily.setDate(inicioDaily.getDate() - Math.max(3, Math.ceil(pingSeriesConfig.catchupHours / 24)));
    await agregarPingDaily(inicioDaily, fimDia);
    await verificarIndicesSeriesTemporais();
  } catch (erro) {
    console.error('Erro no catch-up inicial das series temporais:', erro);
  }
}

async function executarAgendamentos() {
  if (agendadorExecutando) return;
  agendadorExecutando = true;
  try {
  const agora = new Date();
  const hora = inicioHora(agora);
  const horaKey = chaveHora(hora);

  if (horaKey !== ultimaHoraAgregada) {
    try {
      await flushPingLog();
      const inicio = new Date(hora);
      inicio.setHours(inicio.getHours() - 2);
      await agregarPingHourly(inicio, hora);
      ultimaHoraAgregada = horaKey;
    } catch (erro) {
      console.error('Erro ao gerar rollup horario de ping:', erro);
    }
  }

  const diaKey = chaveDia(agora);
  if (agora.getHours() >= 2 && diaKey !== ultimoDiaAgregado) {
    try {
      const fim = inicioDia(agora);
      const inicio = new Date(fim);
      inicio.setDate(inicio.getDate() - 3);
      await agregarPingDaily(inicio, fim);
      ultimoDiaAgregado = diaKey;
    } catch (erro) {
      console.error('Erro ao gerar rollup diario de ping:', erro);
    }
  }

  if (agora.getHours() >= 3 && diaKey !== ultimoDiaPrune) {
    try {
      await executarPrunePing(agora);
      ultimoDiaPrune = diaKey;
    } catch (erro) {
      console.error('Erro na politica de retencao das series temporais:', erro);
    }
  }
  } finally {
    agendadorExecutando = false;
  }
}

export function iniciarServicoSeriesTemporais() {
  if (servicoIniciado) return;
  servicoIniciado = true;

  timerFlush = setInterval(() => void flushPingLog(), pingSeriesConfig.flushMs);
  timerFlush.unref();
  timerAgendador = setInterval(() => void executarAgendamentos(), 60_000);
  timerAgendador.unref();

  void executarCatchupInicial().then(() => executarAgendamentos());
  console.log(
    `Series temporais de ping ativas: raw=${pingSeriesConfig.rawRetentionDays}d, ` +
    `hourly=${pingSeriesConfig.hourlyRetentionMonths}m, ` +
    `daily=${pingSeriesConfig.dailyRetentionYears || 'sem limite'}; ` +
    `flush=${pingSeriesConfig.flushMs}ms/${pingSeriesConfig.batchSize} amostras.`
  );
}

export async function pararServicoSeriesTemporais() {
  if (timerFlush) clearInterval(timerFlush);
  if (timerAgendador) clearInterval(timerAgendador);
  timerFlush = null;
  timerAgendador = null;
  servicoIniciado = false;
  const limite = Date.now() + 10_000;
  let tentativasSemProgresso = 0;
  while (fila.length > 0 && Date.now() < limite && tentativasSemProgresso < 2) {
    const antes = fila.length;
    await flushPingLog();
    tentativasSemProgresso = fila.length < antes ? 0 : tentativasSemProgresso + 1;
  }
  if (fila.length > 0) {
    console.error(`${fila.length} amostra(s) de ping nao puderam ser persistidas no encerramento.`);
  }
}
