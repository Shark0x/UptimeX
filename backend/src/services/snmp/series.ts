import { workerQuery } from '../../db/pool';

// Série temporal de tráfego por interface. Mesmo padrão do pingSeriesService: o
// ciclo de coleta só ENFILEIRA; o flush agrupa em uma inserção. MVP guarda só o
// raw com retenção simples (sem rollup horário/diário — pode vir depois).

export interface AmostraSnmpPersistir {
  timestamp: Date;
  dispositivoId: number;
  empresaId: number;
  ifIndex: number;
  inBps: number | null;
  outBps: number | null;
  inErrPps: number | null;
  outErrPps: number | null;
  inDiscPps: number | null;
  outDiscPps: number | null;
}

export interface AmostraRecursosPersistir {
  timestamp: Date;
  dispositivoId: number;
  empresaId: number;
  cpuPct: number | null;
  cpuCores: number | null;
  memoriaPct: number | null;
  memoriaUsoBytes: number | null;
  memoriaTotalBytes: number | null;
  discoPct: number | null;
  discoUsoBytes: number | null;
  discoTotalBytes: number | null;
}

function numeroAmbiente(nome: string, padrao: number, minimo: number, maximo: number) {
  const valor = Number(process.env[nome]);
  if (!Number.isFinite(valor)) return padrao;
  return Math.min(maximo, Math.max(minimo, Math.trunc(valor)));
}

export const snmpSeriesConfig = Object.freeze({
  batchSize: numeroAmbiente('SNMP_LOG_BATCH_SIZE', 200, 10, 2_000),
  flushMs: numeroAmbiente('SNMP_LOG_FLUSH_MS', 5_000, 1_000, 60_000),
  maxQueueSize: numeroAmbiente('SNMP_LOG_MAX_QUEUE_SIZE', 20_000, 1_000, 200_000),
  rawRetentionDays: numeroAmbiente('SNMP_RAW_RETENTION_DAYS', 15, 2, 365),
  pruneBatchSize: numeroAmbiente('SNMP_PRUNE_BATCH_SIZE', 10_000, 500, 50_000),
});

const fila: AmostraSnmpPersistir[] = [];
const filaRecursos: AmostraRecursosPersistir[] = [];
let flushEmAndamento: Promise<void> | null = null;
let timerFlush: NodeJS.Timeout | null = null;
let timerPrune: NodeJS.Timeout | null = null;
let servicoIniciado = false;

/** Uma amostra só vale a pena persistir se tem ao menos uma métrica calculada. */
export function amostraTemDado(a: AmostraSnmpPersistir): boolean {
  return [a.inBps, a.outBps, a.inErrPps, a.outErrPps, a.inDiscPps, a.outDiscPps].some((v) => v != null);
}

export function amostraRecursoTemDado(a: AmostraRecursosPersistir): boolean {
  return a.cpuPct != null || a.memoriaPct != null || a.discoPct != null;
}

export function enfileirarAmostraSnmp(amostra: AmostraSnmpPersistir) {
  if (!amostraTemDado(amostra)) return;
  if (fila.length >= snmpSeriesConfig.maxQueueSize) {
    const descartadas = fila.length - snmpSeriesConfig.maxQueueSize + 1;
    fila.splice(0, descartadas);
    console.error(`Fila SNMP cheia; ${descartadas} amostra(s) antiga(s) descartada(s).`);
  }
  fila.push(amostra);
  if (fila.length >= snmpSeriesConfig.batchSize) void flushSnmpLog();
}

export function enfileirarAmostraRecursos(amostra: AmostraRecursosPersistir) {
  if (!amostraRecursoTemDado(amostra)) return;
  if (filaRecursos.length >= snmpSeriesConfig.maxQueueSize) {
    const descartadas = filaRecursos.length - snmpSeriesConfig.maxQueueSize + 1;
    filaRecursos.splice(0, descartadas);
    console.error(`Fila de recursos SNMP cheia; ${descartadas} amostra(s) antiga(s) descartada(s).`);
  }
  filaRecursos.push(amostra);
  if (filaRecursos.length >= snmpSeriesConfig.batchSize) void flushSnmpLog();
}

export function tamanhoFilaSnmp() {
  return fila.length + filaRecursos.length;
}

export async function flushSnmpLog(): Promise<void> {
  if (flushEmAndamento) return flushEmAndamento;
  if (fila.length === 0 && filaRecursos.length === 0) return;

  const lote = fila.splice(0, snmpSeriesConfig.batchSize);
  const loteRecursos = filaRecursos.splice(0, snmpSeriesConfig.batchSize);

  flushEmAndamento = (async () => {
    // 1. Interfaces e tráfego
    if (lote.length > 0) {
      const placeholders = lote.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
      const parametros = lote.flatMap((a) => [
        a.dispositivoId, a.empresaId, a.ifIndex, a.timestamp,
        a.inBps, a.outBps, a.inErrPps, a.outErrPps, a.inDiscPps, a.outDiscPps,
      ]);
      try {
        await workerQuery(
          `INSERT INTO snmp_interface_amostras
            (dispositivo_id, empresa_id, if_index, "timestamp",
             in_bps, out_bps, in_err_pps, out_err_pps, in_disc_pps, out_disc_pps)
           VALUES ${placeholders}
           ON CONFLICT (dispositivo_id, if_index, "timestamp") DO UPDATE SET
             in_bps = EXCLUDED.in_bps, out_bps = EXCLUDED.out_bps,
             in_err_pps = EXCLUDED.in_err_pps, out_err_pps = EXCLUDED.out_err_pps,
             in_disc_pps = EXCLUDED.in_disc_pps, out_disc_pps = EXCLUDED.out_disc_pps`,
          parametros
        );
      } catch (erro) {
        const espaco = Math.max(0, snmpSeriesConfig.maxQueueSize - fila.length);
        fila.unshift(...lote.slice(Math.max(0, lote.length - espaco)));
        console.error('Erro ao persistir lote SNMP; amostras voltaram para a fila:', erro);
      }
    }

    // 2. Recursos de hardware (CPU, Memória, Disco)
    if (loteRecursos.length > 0) {
      const placeholdersRec = loteRecursos.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
      const parametrosRec = loteRecursos.flatMap((a) => [
        a.dispositivoId, a.empresaId, a.timestamp,
        a.cpuPct, a.cpuCores, a.memoriaPct, a.memoriaUsoBytes, a.memoriaTotalBytes,
        a.discoPct, a.discoUsoBytes, a.discoTotalBytes,
      ]);
      try {
        await workerQuery(
          `INSERT INTO snmp_recursos_amostras
            (dispositivo_id, empresa_id, "timestamp",
             cpu_pct, cpu_cores, memoria_pct, memoria_uso_bytes, memoria_total_bytes,
             disco_pct, disco_uso_bytes, disco_total_bytes)
           VALUES ${placeholdersRec}
           ON CONFLICT (dispositivo_id, "timestamp") DO UPDATE SET
             cpu_pct = EXCLUDED.cpu_pct, cpu_cores = EXCLUDED.cpu_cores,
             memoria_pct = EXCLUDED.memoria_pct, memoria_uso_bytes = EXCLUDED.memoria_uso_bytes,
             memoria_total_bytes = EXCLUDED.memoria_total_bytes,
             disco_pct = EXCLUDED.disco_pct, disco_uso_bytes = EXCLUDED.disco_uso_bytes,
             disco_total_bytes = EXCLUDED.disco_total_bytes`,
          parametrosRec
        );
      } catch (erro) {
        const espaco = Math.max(0, snmpSeriesConfig.maxQueueSize - filaRecursos.length);
        filaRecursos.unshift(...loteRecursos.slice(Math.max(0, loteRecursos.length - espaco)));
        console.error('Erro ao persistir lote de recursos SNMP:', erro);
      }
    }
  })().finally(() => {
    flushEmAndamento = null;
  });

  return flushEmAndamento;
}

async function apagarEmLotes(limite: Date) {
  let removidas = 0;
  do {
    const [, meta] = await workerQuery(
      `DELETE FROM snmp_interface_amostras
        WHERE ctid IN (
          SELECT ctid FROM snmp_interface_amostras WHERE "timestamp" < ? ORDER BY "timestamp" LIMIT ?
        )`,
      [limite, snmpSeriesConfig.pruneBatchSize]
    );
    removidas = meta.rowCount;
  } while (removidas === snmpSeriesConfig.pruneBatchSize);

  let removidasRec = 0;
  do {
    const [, meta] = await workerQuery(
      `DELETE FROM snmp_recursos_amostras
        WHERE ctid IN (
          SELECT ctid FROM snmp_recursos_amostras WHERE "timestamp" < ? ORDER BY "timestamp" LIMIT ?
        )`,
      [limite, snmpSeriesConfig.pruneBatchSize]
    );
    removidasRec = meta.rowCount;
  } while (removidasRec === snmpSeriesConfig.pruneBatchSize);
}

export async function executarPruneSnmp(referencia = new Date()) {
  const limite = new Date(referencia);
  limite.setDate(limite.getDate() - snmpSeriesConfig.rawRetentionDays);
  await apagarEmLotes(limite);
}

export function iniciarServicoSnmpSeries() {
  if (servicoIniciado) return;
  servicoIniciado = true;
  timerFlush = setInterval(() => void flushSnmpLog(), snmpSeriesConfig.flushMs);
  timerFlush.unref();
  // Retenção uma vez por hora (barato; DELETE em lotes por ctid).
  timerPrune = setInterval(() => {
    executarPruneSnmp().catch((e) => console.error('Erro na retenção SNMP:', e));
  }, 3_600_000);
  timerPrune.unref();
  console.log(
    `Série temporal SNMP ativa: raw=${snmpSeriesConfig.rawRetentionDays}d, ` +
    `flush=${snmpSeriesConfig.flushMs}ms/${snmpSeriesConfig.batchSize} amostras.`
  );
}

export async function pararServicoSnmpSeries() {
  if (timerFlush) clearInterval(timerFlush);
  if (timerPrune) clearInterval(timerPrune);
  timerFlush = null;
  timerPrune = null;
  servicoIniciado = false;
  const limite = Date.now() + 10_000;
  let semProgresso = 0;
  while ((fila.length > 0 || filaRecursos.length > 0) && Date.now() < limite && semProgresso < 2) {
    const antes = fila.length + filaRecursos.length;
    await flushSnmpLog();
    semProgresso = (fila.length + filaRecursos.length) < antes ? 0 : semProgresso + 1;
  }
}
