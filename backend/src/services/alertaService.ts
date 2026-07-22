import { pool } from '../db/pool';
import { obterConfig } from './configService';
import { enviarTelegram, escaparHtml, telegramConfigurado } from './telegramService';

/**
 * Alertas de queda/recuperação com anti-ruído:
 * - QUEDA só alerta se o dispositivo ficar offline por ALERTA_ATRASO_SEG
 *   contínuos (piscada de link não vira mensagem). Se voltar antes, o alerta
 *   agendado é cancelado em silêncio.
 * - RECUPERADO só é enviado se a queda tiver sido alertada, e informa quanto
 *   tempo o enlace ficou fora.
 */

const ATRASO_PADRAO_SEG = 120;
const atrasoMs = () => (Number(obterConfig('alerta_atraso_seg', 'ALERTA_ATRASO_SEG')) || ATRASO_PADRAO_SEG) * 1000;

interface DispositivoAlerta {
  id: number;
  empresa_id: number;
  nome: string;
  ip: string;
}

interface EstadoAlerta {
  timerQueda: NodeJS.Timeout | null;
  inicioQueda: Date | null;
  quedaAlertada: boolean;
}

const estados = new Map<number, EstadoAlerta>();

function estadoDe(id: number): EstadoAlerta {
  let e = estados.get(id);
  if (!e) {
    e = { timerQueda: null, inicioQueda: null, quedaAlertada: false };
    estados.set(id, e);
  }
  return e;
}

async function nomeDaEmpresa(empresaId: number): Promise<string> {
  try {
    const [rows]: any = await pool.query(`SELECT nome FROM empresas WHERE id = ?`, [empresaId]);
    return rows[0]?.nome ?? `empresa ${empresaId}`;
  } catch {
    return `empresa ${empresaId}`;
  }
}

function hora(d: Date): string {
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function duracaoLegivel(ms: number): string {
  const min = Math.round(ms / 60000);
  if (min < 1) return 'menos de 1 min';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h}h${String(min % 60).padStart(2, '0')}`;
}

/** Chamado pelo motor de monitoramento a cada transição online/offline. */
export function notificarTransicao(d: DispositivoAlerta, novoStatus: 'online' | 'offline') {
  if (!telegramConfigurado()) return;
  const e = estadoDe(d.id);

  if (novoStatus === 'offline') {
    e.inicioQueda = new Date();
    if (e.timerQueda) clearTimeout(e.timerQueda);
    e.timerQueda = setTimeout(async () => {
      e.timerQueda = null;
      // Confirma no banco: só alerta se AINDA estiver offline após o atraso
      try {
        const [rows]: any = await pool.query(`SELECT status_atual FROM dispositivos WHERE id = ?`, [d.id]);
        if (rows[0]?.status_atual !== 'offline') return;
      } catch {
        return;
      }
      const empresa = await nomeDaEmpresa(d.empresa_id);
      e.quedaAlertada = true;
      const ok = await enviarTelegram(
        `🔴 <b>QUEDA — ${escaparHtml(empresa)}</b>\n` +
          `${escaparHtml(d.nome)} (<code>${escaparHtml(d.ip)}</code>)\n` +
          `sem resposta há ${duracaoLegivel(atrasoMs())} · ${hora(new Date())}`
      );
      console.log(`[alerta] queda de "${d.nome}" ${ok ? 'enviada ao Telegram' : 'NAO enviada (falha no Telegram)'}`);
    }, atrasoMs());
  } else {
    if (e.timerQueda) {
      clearTimeout(e.timerQueda);
      e.timerQueda = null;
    }
    if (e.quedaAlertada) {
      e.quedaAlertada = false;
      const inicio = e.inicioQueda;
      const duracao = inicio ? duracaoLegivel(Date.now() - inicio.getTime()) : 'tempo desconhecido';
      nomeDaEmpresa(d.empresa_id).then(async (empresa) => {
        const ok = await enviarTelegram(
          `🟢 <b>RECUPERADO — ${escaparHtml(empresa)}</b>\n` +
            `${escaparHtml(d.nome)} (<code>${escaparHtml(d.ip)}</code>)\n` +
            `ficou ${duracao} fora do ar · ${hora(new Date())}`
        );
        console.log(`[alerta] recuperação de "${d.nome}" ${ok ? 'enviada ao Telegram' : 'NAO enviada (falha no Telegram)'}`);
      });
    }
    e.inicioQueda = null;
  }
}

/** Limpa timers pendentes de um dispositivo removido/desativado. */
export function limparAlertas(dispositivoId: number) {
  const e = estados.get(dispositivoId);
  if (e?.timerQueda) clearTimeout(e.timerQueda);
  estados.delete(dispositivoId);
}
