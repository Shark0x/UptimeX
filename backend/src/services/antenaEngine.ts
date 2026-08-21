import { Server as SocketServer } from 'socket.io';
import { workerQuery } from '../db/pool';
import { medirPing, consultarPing } from './pingService';
import { exigirDestinoMonitoramento } from '../security/monitorTarget';

export interface AntenaWireless {
  id: number;
  nome: string;
  ip: string;
  fabricante: string;
  modelo: string | null;
  tipo_wireless: string;
  frequencia_mhz: number | null;
  largura_canal_mhz: number | null;
  ssid: string | null;
  sinal_esperado_dbm: number | null;
  intervalo_polling_seg: number;
  status_atual: 'online' | 'offline' | 'desconhecido';
  latencia_ms: number | null;
  perda_pct: number | null;
  ultima_verificacao: string | null;
  ativo: boolean;
}

interface ResultadoVerificacao {
  online: boolean;
  latenciaMs: number | null;
  perdaPct: number;
}

const timers = new Map<number, NodeJS.Timeout>();
let socketIoInstance: SocketServer | null = null;

export function definirSocketIo(io: SocketServer) {
  socketIoInstance = io;
}

async function verificarAntena(antena: AntenaWireless): Promise<ResultadoVerificacao> {
  exigirDestinoMonitoramento(antena.ip);
  const m = await medirPing(antena.ip, 2);
  return {
    online: m.alcancavel,
    latenciaMs: m.latenciaMs,
    perdaPct: m.perdaPct,
  };
}

async function processarResultado(antena: AntenaWireless, r: ResultadoVerificacao, io?: SocketServer) {
  const novoStatus = r.online ? 'online' : 'offline';
  const agora = new Date();

  await workerQuery(
    `UPDATE antenas
     SET status_atual = ?, ultima_verificacao = ?, latencia_ms = ?, perda_pct = ?
     WHERE id = ?`,
    [novoStatus, agora, r.latenciaMs, r.perdaPct, antena.id]
  );

  // Armazena amostra histórica
  await workerQuery(
    `INSERT INTO antenas_metricas (antena_id, latencia_ms, perda_pct, "timestamp")
     VALUES (?, ?, ?, ?)`,
    [antena.id, r.latenciaMs, r.perdaPct, agora]
  );

  const payload = {
    antenaId: antena.id,
    status: novoStatus,
    latenciaMs: r.latenciaMs,
    perdaPct: r.perdaPct,
    timestamp: agora.toISOString(),
  };

  const ioInst = io || socketIoInstance;
  if (ioInst) {
    const sala = ioInst.to('antenas_noc');
    if (novoStatus !== antena.status_atual) {
      sala.emit('antena:status_mudou', {
        ...payload,
        statusAnterior: antena.status_atual,
        statusNovo: novoStatus,
        nome: antena.nome,
      });
    } else {
      sala.emit('antena:heartbeat', payload);
    }
  }
}

async function ciclo(antenaId: number, io?: SocketServer) {
  const [rows]: any = await workerQuery(
    `SELECT * FROM antenas WHERE id = ? AND ativo = TRUE`,
    [antenaId]
  );

  if (rows.length === 0) {
    pararMonitoramentoAntena(antenaId);
    return;
  }

  const antena: AntenaWireless = rows[0];

  try {
    const res = await verificarAntena(antena);
    await processarResultado(antena, res, io);
  } catch (err) {
    console.error(`[Antenas] Erro ao verificar antena id=${antena.id}.`);
  }

  const intervalo = Math.max(2, antena.intervalo_polling_seg || 10);
  const timer = setTimeout(() => ciclo(antenaId, io), intervalo * 1000);
  timers.set(antenaId, timer);
}

export function iniciarMonitoramentoAntena(antenaId: number, io?: SocketServer) {
  pararMonitoramentoAntena(antenaId);
  const ioInst = io || socketIoInstance || undefined;
  ciclo(antenaId, ioInst);
}

export function pararMonitoramentoAntena(antenaId: number) {
  const t = timers.get(antenaId);
  if (t) {
    clearTimeout(t);
    timers.delete(antenaId);
  }
}

export async function iniciarTodasAntenas(io: SocketServer) {
  definirSocketIo(io);
  const [rows]: any = await workerQuery(`SELECT id FROM antenas WHERE ativo = TRUE`);
  console.log(`[Antenas] Iniciando monitoramento de ${rows.length} antenas wireless`);
  for (const r of rows) {
    iniciarMonitoramentoAntena(r.id, io);
  }
}

export async function executarPingInstantaneo(antenaId: number) {
  const [rows]: any = await workerQuery(`SELECT * FROM antenas WHERE id = ?`, [antenaId]);
  if (rows.length === 0) throw new Error('Antena não encontrada');
  const antena: AntenaWireless = rows[0];
  exigirDestinoMonitoramento(antena.ip);

  const res = await consultarPing(antena.ip, 2);
  const m = await medirPing(antena.ip, 2);

  const agora = new Date();
  const novoStatus = m.alcancavel ? 'online' : 'offline';

  await workerQuery(
    `UPDATE antenas
     SET status_atual = ?, ultima_verificacao = ?, latencia_ms = ?, perda_pct = ?
     WHERE id = ?`,
    [novoStatus, agora, m.latenciaMs, m.perdaPct, antena.id]
  );

  const payload = {
    antenaId: antena.id,
    status: novoStatus,
    latenciaMs: m.latenciaMs,
    perdaPct: m.perdaPct,
    timestamp: agora.toISOString(),
  };

  if (socketIoInstance) {
    socketIoInstance.to('antenas_noc').emit('antena:heartbeat', payload);
  }

  return {
    ...payload,
    alcancavel: m.alcancavel,
    tempoMs: res.tempoMs,
  };
}
