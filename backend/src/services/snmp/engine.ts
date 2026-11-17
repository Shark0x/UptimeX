import { Server as SocketServer } from 'socket.io';
import { workerQuery } from '../../db/pool';
import { criarLimitadorConcorrencia, criarMutexPorChave } from '../concurrency';
import { coletarSnmp, calcularAmostraInterface } from './collector';
import { temCredencialSnmp, montarCredencialSnmp, DispositivoSnmpRow } from './credenciais';
import { carregarLeiturasAnteriores, salvarInterface, atualizarColeta } from './estado';
import { enfileirarAmostraSnmp, enfileirarAmostraRecursos } from './series';

interface DispositivoSnmp extends DispositivoSnmpRow {
  id: number;
  empresa_id: number;
  ip: string;
  nome: string;
  porta_snmp: number;
  intervalo_polling_seg: number;
}

const COLUNAS = `id, empresa_id, nome, host(ip) AS ip, porta_snmp, intervalo_polling_seg,
  snmp_versao, comunidade_snmp, snmp_usuario, snmp_nivel,
  snmp_auth_protocolo, snmp_auth_senha, snmp_priv_protocolo, snmp_priv_senha`;

// Seleciona só dispositivos com credencial SNMP utilizável.
const FILTRO_COM_CREDENCIAL = `(
  (COALESCE(snmp_versao, 'v2c') = 'v2c' AND comunidade_snmp IS NOT NULL AND comunidade_snmp <> '')
  OR (snmp_versao = 'v3' AND snmp_usuario IS NOT NULL AND snmp_usuario <> '')
)`;

const timers = new Map<number, NodeJS.Timeout>();
const geracao = new Map<number, number>();
const mutex = criarMutexPorChave<number>();
// Fila global: teto de dispositivos coletados ao mesmo tempo (protege o Event Loop
// e a rede quando há muitos equipamentos/interfaces). Configurável via env.
const limite = criarLimitadorConcorrencia(Math.max(1, Number(process.env.SNMP_MAX_CONCURRENCY) || 10));

function intervaloSnmpSeg(d: DispositivoSnmp): number {
  // Tráfego não precisa de granularidade de segundos; piso de 10s evita martelar.
  return Math.max(10, Number(d.intervalo_polling_seg) || 30);
}

function emitirColeta(io: SocketServer, d: DispositivoSnmp, extra: Record<string, unknown>) {
  io.to(`empresa_${d.empresa_id}`).to('empresas_admin').emit('snmp_coleta', {
    dispositivoId: d.id,
    empresaId: d.empresa_id,
    ...extra,
    timestamp: new Date(),
  });
}

async function coletarEProcessar(d: DispositivoSnmp, io: SocketServer): Promise<void> {
  let cred;
  try {
    cred = montarCredencialSnmp(d);
  } catch (e) {
    await atualizarColeta({
      dispositivoId: d.id, empresaId: d.empresa_id, status: 'erro', sucesso: false,
      erro: `Credencial SNMP ilegivel: ${(e as Error).message}`.slice(0, 250),
    });
    return;
  }

  const anteriores = await carregarLeiturasAnteriores(d.id);
  const coleta = await coletarSnmp(d.ip, cred, { porta: Number(d.porta_snmp) || 161 });

  if (!coleta.alcancavel) {
    await atualizarColeta({
      dispositivoId: d.id, empresaId: d.empresa_id, status: 'erro', sucesso: false,
      erro: (coleta.erro || 'sem resposta SNMP').slice(0, 250),
    });
    emitirColeta(io, d, { status: 'erro' });
    return;
  }

  const quando = new Date();
  const uptime = coleta.sysUptimeTicks ?? 0;
  for (const iface of coleta.interfaces) {
    const amostra = calcularAmostraInterface(iface, anteriores.get(iface.ifIndex) ?? null, uptime, quando.getTime());
    await salvarInterface(d.id, d.empresa_id, iface, amostra, uptime, quando);
    enfileirarAmostraSnmp({
      timestamp: quando, dispositivoId: d.id, empresaId: d.empresa_id, ifIndex: iface.ifIndex,
      inBps: amostra.inBps, outBps: amostra.outBps,
      inErrPps: amostra.inErrPps, outErrPps: amostra.outErrPps,
      inDiscPps: amostra.inDiscPps, outDiscPps: amostra.outDiscPps,
    });
  }

  // Enfileira série temporal de recursos do servidor (CPU, Memória, Disco)
  enfileirarAmostraRecursos({
    timestamp: quando,
    dispositivoId: d.id,
    empresaId: d.empresa_id,
    cpuPct: coleta.recursos.cpuPct,
    cpuCores: coleta.recursos.cpuCores,
    memoriaPct: coleta.recursos.memoriaPct,
    memoriaUsoBytes: coleta.recursos.memoriaUsoBytes,
    memoriaTotalBytes: coleta.recursos.memoriaTotalBytes,
    discoPct: coleta.recursos.discoPct,
    discoUsoBytes: coleta.recursos.discoUsoBytes,
    discoTotalBytes: coleta.recursos.discoTotalBytes,
  });

  await atualizarColeta({
    dispositivoId: d.id, empresaId: d.empresa_id, status: 'ok', sucesso: true,
    sysUptimeTicks: coleta.sysUptimeTicks, sysDescr: coleta.sysDescr, sysName: coleta.sysName,
    totalInterfaces: coleta.interfaces.length, erro: null,
    cpuPct: coleta.recursos.cpuPct,
    cpuCores: coleta.recursos.cpuCores,
    memoriaUsoBytes: coleta.recursos.memoriaUsoBytes,
    memoriaTotalBytes: coleta.recursos.memoriaTotalBytes,
    memoriaPct: coleta.recursos.memoriaPct,
    discoUsoBytes: coleta.recursos.discoUsoBytes,
    discoTotalBytes: coleta.recursos.discoTotalBytes,
    discoPct: coleta.recursos.discoPct,
  });
  emitirColeta(io, d, {
    status: 'ok',
    totalInterfaces: coleta.interfaces.length,
    cpuPct: coleta.recursos.cpuPct,
    cpuCores: coleta.recursos.cpuCores,
    memoriaPct: coleta.recursos.memoriaPct,
    memoriaUsoBytes: coleta.recursos.memoriaUsoBytes,
    memoriaTotalBytes: coleta.recursos.memoriaTotalBytes,
    discoPct: coleta.recursos.discoPct,
  });
}

async function cicloSnmp(dispositivoId: number, io: SocketServer, g: number): Promise<void> {
  let intervaloSeg = 30;
  let reagendavel = true;
  try {
    // A consulta inicial fica DENTRO do try: um hiccup do banco nunca pode impedir
    // o reagendamento (ele acontece no finally).
    const [rows]: any = await workerQuery(
      `SELECT ${COLUNAS} FROM dispositivos WHERE id = ? AND ativo = TRUE`,
      [dispositivoId]
    );
    if (rows.length === 0) {
      pararColetaSnmp(dispositivoId);
      reagendavel = false;
      return;
    }
    const d: DispositivoSnmp = rows[0];
    intervaloSeg = intervaloSnmpSeg(d);

    if (!temCredencialSnmp(d)) {
      await atualizarColeta({
        dispositivoId: d.id, empresaId: d.empresa_id, status: 'sem_credencial', sucesso: false, erro: null,
      });
      pararColetaSnmp(dispositivoId); // sem credencial: não há o que coletar
      reagendavel = false;
      return;
    }

    // Mutex por dispositivo (serializa com diagnóstico manual e edições) dentro do
    // limitador global de concorrência.
    await mutex(dispositivoId, () => limite(() => coletarEProcessar(d, io)));
  } catch (err) {
    console.error(
      `Erro no ciclo SNMP do dispositivo id=${dispositivoId}:`,
      err instanceof Error ? err.message : err
    );
  } finally {
    if (reagendavel) reagendar(dispositivoId, io, g, intervaloSeg * 1000);
  }
}

function reagendar(id: number, io: SocketServer, g: number, ms: number) {
  // Só reagenda se ESTA geração ainda é a vigente. Um iniciar/parar mais recente
  // (edição do dispositivo, parada do serviço) incrementa a geração e invalida
  // os ciclos em voo — elimina loops concorrentes.
  if (geracao.get(id) !== g) return;
  const timer = setTimeout(() => cicloSnmp(id, io, g), ms);
  timers.set(id, timer);
}

export function iniciarColetaSnmp(dispositivoId: number, io: SocketServer) {
  pararColetaSnmp(dispositivoId); // incrementa a geração
  const g = geracao.get(dispositivoId)!;
  void cicloSnmp(dispositivoId, io, g);
}

export function pararColetaSnmp(dispositivoId: number) {
  const t = timers.get(dispositivoId);
  if (t) {
    clearTimeout(t);
    timers.delete(dispositivoId);
  }
  geracao.set(dispositivoId, (geracao.get(dispositivoId) || 0) + 1);
}

/**
 * Coleta SNMP sob demanda ("Coletar agora"): roda um ciclo imediato, serializado
 * com o polling regular pelo mutex. Não mexe no timer. Devolve null se o
 * dispositivo não existe/está inativo.
 */
export async function verificarSnmpAgora(
  dispositivoId: number,
  io: SocketServer
): Promise<{ status: string } | null> {
  const [rows]: any = await workerQuery(
    `SELECT ${COLUNAS} FROM dispositivos WHERE id = ? AND ativo = TRUE`,
    [dispositivoId]
  );
  if (rows.length === 0) return null;
  const d: DispositivoSnmp = rows[0];
  if (!temCredencialSnmp(d)) {
    await atualizarColeta({
      dispositivoId: d.id, empresaId: d.empresa_id, status: 'sem_credencial', sucesso: false, erro: null,
    });
    return { status: 'sem_credencial' };
  }
  await mutex(dispositivoId, () => limite(() => coletarEProcessar(d, io)));
  return { status: 'ok' };
}

/** Garante idempotência de colunas e tabelas para métricas de recursos de servidores. */
export async function garantirSchemaSnmpRecursos(): Promise<void> {
  try {
    await workerQuery(`
      ALTER TABLE snmp_coleta ADD COLUMN IF NOT EXISTS cpu_pct double precision;
      ALTER TABLE snmp_coleta ADD COLUMN IF NOT EXISTS cpu_cores integer;
      ALTER TABLE snmp_coleta ADD COLUMN IF NOT EXISTS memoria_uso_bytes bigint;
      ALTER TABLE snmp_coleta ADD COLUMN IF NOT EXISTS memoria_total_bytes bigint;
      ALTER TABLE snmp_coleta ADD COLUMN IF NOT EXISTS memoria_pct double precision;
      ALTER TABLE snmp_coleta ADD COLUMN IF NOT EXISTS disco_uso_bytes bigint;
      ALTER TABLE snmp_coleta ADD COLUMN IF NOT EXISTS disco_total_bytes bigint;
      ALTER TABLE snmp_coleta ADD COLUMN IF NOT EXISTS disco_pct double precision;

      CREATE TABLE IF NOT EXISTS snmp_recursos_amostras (
        dispositivo_id bigint NOT NULL REFERENCES dispositivos(id) ON DELETE CASCADE,
        empresa_id bigint NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        "timestamp" timestamp(3) without time zone NOT NULL,
        cpu_pct double precision,
        cpu_cores integer,
        memoria_pct double precision,
        memoria_uso_bytes bigint,
        memoria_total_bytes bigint,
        disco_pct double precision,
        disco_uso_bytes bigint,
        disco_total_bytes bigint,
        UNIQUE (dispositivo_id, "timestamp")
      );

      CREATE INDEX IF NOT EXISTS idx_snmp_recursos_dev_ts ON snmp_recursos_amostras(dispositivo_id, "timestamp");
      CREATE INDEX IF NOT EXISTS idx_snmp_recursos_empresa_ts ON snmp_recursos_amostras(empresa_id, "timestamp");
    `);
  } catch (err) {
    console.warn('Aviso ao sincronizar schema de recursos SNMP:', err instanceof Error ? err.message : err);
  }
}

/** Inicia a engine SNMP para todos os dispositivos ativos COM credencial (boot). */
export async function iniciarColetaSnmpTodos(io: SocketServer) {
  await garantirSchemaSnmpRecursos();
  const [rows]: any = await workerQuery(
    `SELECT id FROM dispositivos WHERE ativo = TRUE AND ${FILTRO_COM_CREDENCIAL}`
  );
  for (const row of rows) iniciarColetaSnmp(row.id, io);
  console.log(`Engine SNMP iniciada para ${rows.length} dispositivo(s) com credencial.`);
}
