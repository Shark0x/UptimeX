import { workerQuery } from '../db/pool';
import { consultarSnmp } from './snmpService';
import { medirPing } from './pingService';
import { limparAlertas, notificarTransicao } from './alertaService';
import { classificarAmostraPing, enfileirarAmostraPing } from './pingSeriesService';
import { Server as SocketServer } from 'socket.io';
import {
  chaveCriptografiaConfigurada,
  criptografarSegredo,
  descriptografarSegredo,
} from '../security/secretCrypto';
import { exigirDestinoMonitoramento } from '../security/monitorTarget';
import { criarMutexPorChave } from './concurrency';

interface Dispositivo {
  id: number;
  empresa_id: number;
  nome: string;
  ip: string;
  metodo_monitoramento: 'snmp' | 'ping' | 'snmp+ping';
  comunidade_snmp: string | null;
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

// Timers ativos por dispositivo, pra podermos parar/reiniciar quando o intervalo muda
const timers = new Map<number, NodeJS.Timeout>();
// Geração por dispositivo: iniciar/parar incrementa o número; um ciclo em voo com
// geração obsoleta não reagenda. Elimina loops de polling concorrentes quando o
// dispositivo é editado (reinicia o monitoramento) ou o serviço é reiniciado.
const geracao = new Map<number, number>();
// Mutex por dispositivo: a coleta agendada e a verificação manual (verificarAgora)
// do MESMO dispositivo nunca rodam sobrepostas.
const mutexDispositivo = criarMutexPorChave<number>();

async function verificarStatus(d: Dispositivo): Promise<ResultadoVerificacao> {
  exigirDestinoMonitoramento(d.ip);
  // A comunidade SNMP só é necessária nos métodos SNMP; decriptamos SOB DEMANDA.
  // Assim um dispositivo 'ping' segue monitorado mesmo que a comunidade guardada
  // não decripte (ex.: DATA_ENCRYPTION_KEY trocada) — antes, o decrypt no topo
  // lançava e QUEBRAVA o ping de TODOS os dispositivos.
  const obterComunidade = () => descriptografarSegredo(d.comunidade_snmp);

  // SNMP puro: sem métricas de ping, só alcance.
  if (d.metodo_monitoramento === 'snmp') {
    const comunidade = obterComunidade();
    if (!comunidade) throw new Error('Comunidade SNMP nao configurada');
    const snmpRes = await consultarSnmp(d.ip, comunidade, d.porta_snmp);
    return { online: snmpRes.alcancavel, latenciaMs: null, perdaPct: null };
  }

  // Ping é a fonte de latência/perda de pacotes. No modo snmp+ping o SNMP entra
  // como segunda opinião antes de declarar offline (equipamento pode bloquear ICMP).
  const m = await medirPing(d.ip);
  if (m.alcancavel) {
    return { online: true, latenciaMs: m.latenciaMs, perdaPct: m.perdaPct };
  }
  if (d.metodo_monitoramento === 'snmp+ping') {
    const comunidade = obterComunidade();
    if (!comunidade) throw new Error('Comunidade SNMP nao configurada');
    const snmpRes = await consultarSnmp(d.ip, comunidade, d.porta_snmp);
    if (snmpRes.alcancavel) return { online: true, latenciaMs: null, perdaPct: m.perdaPct };
  }
  return { online: false, latenciaMs: null, perdaPct: 100 };
}

async function processarResultado(d: Dispositivo, r: ResultadoVerificacao, io: SocketServer) {
  const novoStatus = r.online ? 'online' : 'offline';
  const agora = new Date();

  await workerQuery(
    `UPDATE dispositivos SET status_atual = ?, ultima_verificacao = ?, latencia_ms = ?, perda_pct = ? WHERE id = ?`,
    [novoStatus, agora, r.latenciaMs, r.perdaPct, d.id]
  );

  // O historico nao participa da latencia do polling: a escrita e feita em lotes
  // pelo servico de series temporais (inclusive quedas: latencia NULL + perda 100).
  if (r.perdaPct !== null) {
    enfileirarAmostraPing({
      timestamp: agora,
      deviceId: d.id,
      empresaId: d.empresa_id,
      latencyMs: r.latenciaMs,
      packetLoss: r.perdaPct,
      status: classificarAmostraPing(r.online, r.latenciaMs, r.perdaPct),
    });
  }

  const payloadMetricas = {
    latenciaMs: r.latenciaMs,
    perdaPct: r.perdaPct,
    timestamp: agora,
  };

  if (novoStatus !== d.status_atual) {
    // Fecha o evento aberto anterior (se existir) calculando a duração
    const [abertos]: any = await workerQuery(
      `SELECT id, inicio FROM status_eventos WHERE dispositivo_id = ? AND fim IS NULL ORDER BY id DESC LIMIT 1`,
      [d.id]
    );
    if (abertos.length > 0) {
      const inicio = new Date(abertos[0].inicio);
      const duracaoSeg = Math.round((agora.getTime() - inicio.getTime()) / 1000);
      await workerQuery(
        `UPDATE status_eventos SET fim = ?, duracao_segundos = ? WHERE id = ?`,
        [agora, duracaoSeg, abertos[0].id]
      );
    }

    // Abre novo evento
    await workerQuery(
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

    // O mural reage imediatamente, mas o evento continua limitado a quem pode
    // acessar a empresa. Administradores usam uma sala global exclusiva.
    io.to(`empresa_${d.empresa_id}`).to('empresas_admin').emit('status_global', {
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

async function ciclo(dispositivoId: number, io: SocketServer, g: number) {
  let intervaloMs = 30_000;
  let reagendavel = true;
  try {
    // A consulta inicial fica DENTRO do try/finally: um timeout ou hiccup do banco
    // nunca pode impedir o reagendamento do próximo ciclo.
    const [rows]: any = await workerQuery(`SELECT * FROM dispositivos WHERE id = ? AND ativo = TRUE`, [dispositivoId]);
    if (rows.length === 0) {
      pararMonitoramento(dispositivoId);
      limparAlertas(dispositivoId);
      reagendavel = false;
      return;
    }
    const d: Dispositivo = rows[0];
    intervaloMs = (Number(d.intervalo_polling_seg) || 30) * 1000;

    await mutexDispositivo(dispositivoId, async () => {
      try {
        const resultado = await verificarStatus(d);
        await processarResultado(d, resultado, io);
      } catch (err) {
        console.error(`Erro ao verificar dispositivo id=${d.id}:`, err instanceof Error ? err.message : err);
      }
    });
  } catch (err) {
    // Falha ao LER o dispositivo (banco indisponível, etc.). Loga e segue para o
    // reagendamento — o ciclo não pode morrer por um erro transitório.
    console.error(`Erro ao carregar dispositivo id=${dispositivoId} para o ciclo:`, err instanceof Error ? err.message : err);
  } finally {
    if (reagendavel) reagendarCiclo(dispositivoId, io, g, intervaloMs);
  }
}

function reagendarCiclo(dispositivoId: number, io: SocketServer, g: number, ms: number) {
  // Só reagenda se ESTA geração ainda é a vigente. Após um iniciar/parar mais
  // recente, o ciclo em voo (geração antiga) não cria um timer duplicado.
  if (geracao.get(dispositivoId) !== g) return;
  const timer = setTimeout(() => ciclo(dispositivoId, io, g), ms);
  timers.set(dispositivoId, timer);
}

export function iniciarMonitoramento(dispositivoId: number, io: SocketServer) {
  pararMonitoramento(dispositivoId); // incrementa a geração e limpa o timer vigente
  const g = geracao.get(dispositivoId)!;
  void ciclo(dispositivoId, io, g);
}

/**
 * Verificação sob demanda ("Testar ping agora"): roda UM ciclo imediato, fora do
 * intervalo de polling, e devolve o resultado. Atualiza status/histórico e emite
 * os mesmos eventos de um ciclo normal — então o painel aberto recupera na hora
 * se o equipamento responder. NÃO mexe no timer do polling regular (que segue no
 * seu ritmo). Devolve null se o dispositivo não existe ou está inativo.
 */
export async function verificarAgora(
  dispositivoId: number,
  io: SocketServer
): Promise<ResultadoVerificacao | null> {
  const [rows]: any = await workerQuery(`SELECT * FROM dispositivos WHERE id = ? AND ativo = TRUE`, [dispositivoId]);
  if (rows.length === 0) return null;
  const d: Dispositivo = rows[0];
  // Serializa com o ciclo agendado: o diagnóstico manual não sobrepõe uma coleta.
  return mutexDispositivo(dispositivoId, async () => {
    const resultado = await verificarStatus(d);
    await processarResultado(d, resultado, io);
    return resultado;
  });
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
  // Invalida qualquer ciclo em voo deste dispositivo: a geração muda, então o
  // reagendamento do ciclo antigo vira no-op (sem timers duplicados).
  geracao.set(dispositivoId, (geracao.get(dispositivoId) || 0) + 1);
}

/** Inicializa o motor pra todos os dispositivos ativos no banco (chamado no boot do servidor) */
export async function iniciarTodosDispositivos(io: SocketServer) {
  if (chaveCriptografiaConfigurada()) {
    const [legados]: any = await workerQuery(
      `SELECT id, comunidade_snmp FROM dispositivos
       WHERE comunidade_snmp IS NOT NULL AND comunidade_snmp <> '' AND comunidade_snmp NOT LIKE 'enc:v1:%'`
    );
    for (const item of legados) {
      await workerQuery(`UPDATE dispositivos SET comunidade_snmp = ? WHERE id = ?`, [
        criptografarSegredo(String(item.comunidade_snmp)),
        item.id,
      ]);
    }
    if (legados.length > 0) console.log(`Credenciais SNMP legadas protegidas: ${legados.length}.`);
  } else {
    console.warn('DATA_ENCRYPTION_KEY ausente: novos segredos SNMP nao podem ser salvos com seguranca.');
  }
  const [rows]: any = await workerQuery(`SELECT id FROM dispositivos WHERE ativo = TRUE`);
  for (const row of rows) {
    iniciarMonitoramento(row.id, io);
  }
  console.log(`Motor de monitoramento iniciado para ${rows.length} dispositivo(s).`);
}
