import { pool } from '../db/pool';
import { consultarSnmp } from './snmpService';
import { medirPing } from './pingService';
import { limparAlertas, notificarTransicao } from './alertaService';
import { Server as SocketServer } from 'socket.io';

interface Dispositivo {
  id: number;
  empresa_id: number;
  nome: string;
  ip: string;
  metodo_monitoramento: 'snmp' | 'ping' | 'snmp+ping';
  comunidade_snmp: string;
  porta_snmp: number;
  intervalo_polling_seg: number;
  status_atual: 'online' | 'offline' | 'desconhecido';
}

interface ResultadoVerificacao {
  online: boolean;
  /** Latência média do ciclo em ms; NULL quando o método não mede (SNMP puro) ou queda total */
  latenciaMs: number | null;
  /** Perda de pacotes do ciclo em %; NULL quando o método não mede (SNMP puro) */
  perdaPct: number | null;
}

/** Dias de amostras de ping mantidos no banco antes da limpeza automática */
const RETENCAO_METRICAS_DIAS = 7;

// Timers ativos por dispositivo, pra podermos parar/reiniciar quando o intervalo muda
const timers = new Map<number, NodeJS.Timeout>();

async function verificarStatus(d: Dispositivo): Promise<ResultadoVerificacao> {
  // SNMP puro: sem métricas de ping, só alcance.
  if (d.metodo_monitoramento === 'snmp') {
    const snmpRes = await consultarSnmp(d.ip, d.comunidade_snmp, d.porta_snmp);
    return { online: snmpRes.alcancavel, latenciaMs: null, perdaPct: null };
  }

  // Ping é a fonte de latência/perda de pacotes. No modo snmp+ping o SNMP entra
  // como segunda opinião antes de declarar offline (equipamento pode bloquear ICMP).
  const m = await medirPing(d.ip);
  if (m.alcancavel) {
    return { online: true, latenciaMs: m.latenciaMs, perdaPct: m.perdaPct };
  }
  if (d.metodo_monitoramento === 'snmp+ping') {
    const snmpRes = await consultarSnmp(d.ip, d.comunidade_snmp, d.porta_snmp);
    if (snmpRes.alcancavel) return { online: true, latenciaMs: null, perdaPct: m.perdaPct };
  }
  return { online: false, latenciaMs: null, perdaPct: 100 };
}

async function processarResultado(d: Dispositivo, r: ResultadoVerificacao, io: SocketServer) {
  const novoStatus = r.online ? 'online' : 'offline';
  const agora = new Date();

  await pool.query(
    `UPDATE dispositivos SET status_atual = ?, ultima_verificacao = ?, latencia_ms = ?, perda_pct = ? WHERE id = ?`,
    [novoStatus, agora, r.latenciaMs, r.perdaPct, d.id]
  );

  // Grava a amostra pro histórico de gráficos (inclusive quedas: latência NULL + perda 100)
  if (r.perdaPct !== null) {
    await pool.query(
      `INSERT INTO ping_metricas (dispositivo_id, latencia_ms, perda_pct, timestamp) VALUES (?, ?, ?, ?)`,
      [d.id, r.latenciaMs, r.perdaPct, agora]
    );
  }

  const payloadMetricas = {
    latenciaMs: r.latenciaMs,
    perdaPct: r.perdaPct,
    timestamp: agora,
  };

  if (novoStatus !== d.status_atual) {
    // Fecha o evento aberto anterior (se existir) calculando a duração
    const [abertos]: any = await pool.query(
      `SELECT id, inicio FROM status_eventos WHERE dispositivo_id = ? AND fim IS NULL ORDER BY id DESC LIMIT 1`,
      [d.id]
    );
    if (abertos.length > 0) {
      const inicio = new Date(abertos[0].inicio);
      const duracaoSeg = Math.round((agora.getTime() - inicio.getTime()) / 1000);
      await pool.query(
        `UPDATE status_eventos SET fim = ?, duracao_segundos = ? WHERE id = ?`,
        [agora, duracaoSeg, abertos[0].id]
      );
    }

    // Abre novo evento
    await pool.query(
      `INSERT INTO status_eventos (dispositivo_id, status, inicio) VALUES (?, ?, ?)`,
      [d.id, novoStatus, agora]
    );

    // Alerta externo (Telegram) com anti-ruído — só transições reais chegam aqui
    notificarTransicao({ id: d.id, empresa_id: d.empresa_id, nome: d.nome, ip: d.ip }, novoStatus);

    // Notifica o frontend em tempo real (quem está com ESTA empresa aberta)
    io.to(`empresa_${d.empresa_id}`).emit('status_mudou', {
      dispositivoId: d.id,
      nome: d.nome,
      statusAnterior: d.status_atual,
      statusNovo: novoStatus,
      ...payloadMetricas,
    });

    // Broadcast global: o mural da TV do suporte reage na hora que QUALQUER IP
    // cai/volta, sem precisar estar na sala da empresa.
    io.emit('status_global', {
      empresaId: d.empresa_id,
      dispositivoId: d.id,
      dispositivo: d.nome,
      statusNovo: novoStatus,
      timestamp: agora,
    });
  } else {
    // Mesmo status: heartbeat com as métricas do ciclo pro painel atualizar
    // latência/perda ao vivo sem refetch.
    io.to(`empresa_${d.empresa_id}`).emit('heartbeat', {
      dispositivoId: d.id,
      status: novoStatus,
      ...payloadMetricas,
    });
  }
}

async function ciclo(dispositivoId: number, io: SocketServer) {
  const [rows]: any = await pool.query(`SELECT * FROM dispositivos WHERE id = ? AND ativo = TRUE`, [dispositivoId]);
  if (rows.length === 0) {
    pararMonitoramento(dispositivoId);
    limparAlertas(dispositivoId);
    return;
  }
  const d: Dispositivo = rows[0];

  try {
    const resultado = await verificarStatus(d);
    await processarResultado(d, resultado, io);
  } catch (err) {
    console.error(`Erro ao verificar dispositivo ${d.nome} (${d.ip}):`, err);
  }

  const timer = setTimeout(() => ciclo(dispositivoId, io), d.intervalo_polling_seg * 1000);
  timers.set(dispositivoId, timer);
}

export function iniciarMonitoramento(dispositivoId: number, io: SocketServer) {
  pararMonitoramento(dispositivoId);
  ciclo(dispositivoId, io);
}

// Nota: NÃO limpa o rastreio de alertas aqui — editar um dispositivo reinicia o
// polling, e se a queda já foi alertada o "recuperado" ainda precisa sair quando
// ele voltar. A limpeza acontece só em remoção/desativação (rotas + ciclo).
export function pararMonitoramento(dispositivoId: number) {
  const t = timers.get(dispositivoId);
  if (t) {
    clearTimeout(t);
    timers.delete(dispositivoId);
  }
}

/** Inicializa o motor pra todos os dispositivos ativos no banco (chamado no boot do servidor) */
export async function iniciarTodosDispositivos(io: SocketServer) {
  const [rows]: any = await pool.query(`SELECT id FROM dispositivos WHERE ativo = TRUE`);
  for (const row of rows) {
    iniciarMonitoramento(row.id, io);
  }
  console.log(`Motor de monitoramento iniciado para ${rows.length} dispositivo(s).`);

  // Limpeza horária das amostras antigas pra tabela não crescer sem limite
  setInterval(async () => {
    try {
      await pool.query(
        `DELETE FROM ping_metricas WHERE timestamp < NOW() - INTERVAL ? DAY`,
        [RETENCAO_METRICAS_DIAS]
      );
    } catch (err) {
      console.error('Erro na limpeza de métricas antigas:', err);
    }
  }, 60 * 60 * 1000);
}
