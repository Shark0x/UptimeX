import { workerQuery } from '../db/pool';
import { obterConfig } from './configService';
import { enviarTelegram, escaparHtml, telegramConfigurado } from './telegramService';

/**
 * Resumo periódico (diário/semanal) enviado ao Telegram: quantas quedas houve no
 * período, tempo total fora do ar, empresas/dispositivos afetados e o ranking de
 * "quem mais caiu". Roda por um agendador leve (setInterval), sem dependência de
 * cron externa. Config pela tabela `configuracoes` (mesma tela dos alertas).
 */

export type PeriodoResumo = 'diario' | 'semanal';

const DEFAULTS = {
  diario_ativo: true,
  diario_hora: 8,
  semanal_ativo: true,
  semanal_dia: 1, // 0=domingo … 6=sábado (padrão: segunda)
  semanal_hora: 8,
};

function configBool(chave: string, padrao: boolean): boolean {
  const v = obterConfig(chave);
  if (v === '') return padrao;
  return v === '1' || v.toLowerCase() === 'true';
}

function configNum(chave: string, padrao: number): number {
  const v = obterConfig(chave);
  if (v === '') return padrao;
  const n = Number(v);
  return Number.isFinite(n) ? n : padrao;
}

/** Configuração atual dos resumos (pra pré-preencher a tela e para o agendador). */
export function obterConfigResumo() {
  return {
    diarioAtivo: configBool('resumo_diario_ativo', DEFAULTS.diario_ativo),
    diarioHora: configNum('resumo_diario_hora', DEFAULTS.diario_hora),
    semanalAtivo: configBool('resumo_semanal_ativo', DEFAULTS.semanal_ativo),
    semanalDia: configNum('resumo_semanal_dia', DEFAULTS.semanal_dia),
    semanalHora: configNum('resumo_semanal_hora', DEFAULTS.semanal_hora),
  };
}

function duracaoLegivel(segundos: number): string {
  const seg = Math.max(0, Math.round(segundos));
  const min = Math.round(seg / 60);
  if (seg < 60) return 'menos de 1 min';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h < 24) return `${h}h${String(m).padStart(2, '0')}`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

function formatarData(d: Date): string {
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

interface DadosResumo {
  quedas: number;
  dispositivosAfetados: number;
  empresasAfetadas: number;
  downtimeSeg: number;
  offlineAgora: number;
  totalAtivos: number;
  top: { dispositivo: string; empresa: string; ip: string; quedas: number; downtimeSeg: number }[];
}

async function coletar(desde: Date, ate: Date): Promise<DadosResumo> {
  // Quedas iniciadas no período + quantos ativos/empresas foram atingidos
  const [totais]: any = await workerQuery(
    `SELECT COUNT(*) AS quedas,
            COUNT(DISTINCT se.dispositivo_id) AS dispositivos_afetados,
            COUNT(DISTINCT d.empresa_id) AS empresas_afetadas
       FROM status_eventos se
       JOIN dispositivos d ON d.id = se.dispositivo_id
      WHERE se.status = 'offline' AND se.inicio >= ? AND se.inicio < ?`,
    [desde, ate]
  );

  // Tempo total fora do ar no período — sobreposição da queda com a janela
  // (inclui quedas ainda abertas, cortadas em NOW()).
  const [tempo]: any = await workerQuery(
    `SELECT COALESCE(SUM(GREATEST(0,
              EXTRACT(EPOCH FROM (LEAST(COALESCE(se.fim, NOW()), ?) - GREATEST(se.inicio, ?)))
            )), 0) AS downtime_seg
       FROM status_eventos se
      WHERE se.status = 'offline' AND se.inicio < ? AND COALESCE(se.fim, NOW()) > ?`,
    [ate, desde, ate, desde]
  );

  // Ranking: quem mais caiu (por nº de quedas, desempate por tempo fora)
  const [top]: any = await workerQuery(
    `SELECT d.nome AS dispositivo, e.nome AS empresa, d.ip,
            COUNT(*) AS quedas,
            COALESCE(SUM(se.duracao_segundos), 0) AS downtime_seg
       FROM status_eventos se
       JOIN dispositivos d ON d.id = se.dispositivo_id
       JOIN empresas e ON e.id = d.empresa_id
      WHERE se.status = 'offline' AND se.inicio >= ? AND se.inicio < ?
      GROUP BY d.id, e.id
      ORDER BY quedas DESC, downtime_seg DESC
      LIMIT 5`,
    [desde, ate]
  );

  const [agora]: any = await workerQuery(
    `SELECT
       COUNT(*) FILTER (WHERE status_atual = 'offline') AS offline_agora,
       COUNT(*) AS total
     FROM dispositivos WHERE ativo = TRUE`
  );

  return {
    quedas: Number(totais[0]?.quedas ?? 0),
    dispositivosAfetados: Number(totais[0]?.dispositivos_afetados ?? 0),
    empresasAfetadas: Number(totais[0]?.empresas_afetadas ?? 0),
    downtimeSeg: Number(tempo[0]?.downtime_seg ?? 0),
    offlineAgora: Number(agora[0]?.offline_agora ?? 0),
    totalAtivos: Number(agora[0]?.total ?? 0),
    top: (top as any[]).map((r) => ({
      dispositivo: String(r.dispositivo),
      empresa: String(r.empresa),
      ip: String(r.ip),
      quedas: Number(r.quedas),
      downtimeSeg: Number(r.downtime_seg),
    })),
  };
}

function montarMensagem(periodo: PeriodoResumo, desde: Date, ate: Date, d: DadosResumo): string {
  const titulo = periodo === 'diario' ? 'Resumo diário' : 'Resumo semanal';
  const janela = periodo === 'diario' ? 'últimas 24h' : 'últimos 7 dias';
  const cabecalho =
    `📊 <b>${titulo} — uptimeX</b>\n` +
    `<i>${formatarData(desde)} → ${formatarData(ate)} · ${janela}</i>\n`;

  if (d.quedas === 0) {
    return (
      cabecalho +
      `\n✅ <b>Nenhuma queda no período.</b>\n` +
      `${d.totalAtivos} ${d.totalAtivos === 1 ? 'dispositivo monitorado' : 'dispositivos monitorados'} — tudo no ar.`
    );
  }

  const linhasTop = d.top
    .map((t, i) => {
      const nome = `${escaparHtml(t.empresa)} · ${escaparHtml(t.dispositivo)}`;
      const vezes = `${t.quedas}×`;
      const tempo = t.downtimeSeg > 0 ? ` (${duracaoLegivel(t.downtimeSeg)})` : '';
      return `${i + 1}. ${nome} — <b>${vezes}</b>${tempo}`;
    })
    .join('\n');

  return (
    cabecalho +
    `\n🔴 Quedas: <b>${d.quedas}</b>\n` +
    `🏢 Empresas afetadas: <b>${d.empresasAfetadas}</b>\n` +
    `📡 Dispositivos afetados: <b>${d.dispositivosAfetados}</b>\n` +
    `⏱️ Tempo total fora: <b>${duracaoLegivel(d.downtimeSeg)}</b>\n` +
    `📉 Fora do ar agora: <b>${d.offlineAgora}</b> de ${d.totalAtivos}\n` +
    `\n<b>Quem mais caiu</b>\n${linhasTop}`
  );
}

/** Monta e envia o resumo do período. Usado pelo agendador e pelo botão de teste. */
export async function enviarResumo(periodo: PeriodoResumo): Promise<boolean> {
  if (!telegramConfigurado()) return false;
  const ate = new Date();
  const desde = new Date(ate);
  if (periodo === 'diario') desde.setDate(desde.getDate() - 1);
  else desde.setDate(desde.getDate() - 7);

  const dados = await coletar(desde, ate);
  const ok = await enviarTelegram(montarMensagem(periodo, desde, ate, dados));
  console.log(`[resumo] ${periodo} ${ok ? 'enviado ao Telegram' : 'NAO enviado (Telegram off ou recusou)'}`);
  return ok;
}

// -------- Agendador leve (checa a cada minuto se chegou a hora) --------

let ultimoDiario = '';
let ultimoSemanal = '';

function chaveDia(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function alvoDeHoje(hora: number): Date {
  const d = new Date();
  d.setHours(hora, 0, 0, 0);
  return d;
}

async function verificarAgenda() {
  if (!telegramConfigurado()) return;
  const cfg = obterConfigResumo();
  const agora = new Date();
  const hoje = chaveDia(agora);

  if (cfg.diarioAtivo && agora >= alvoDeHoje(cfg.diarioHora) && ultimoDiario !== hoje) {
    ultimoDiario = hoje;
    await enviarResumo('diario');
  }

  if (
    cfg.semanalAtivo &&
    agora.getDay() === cfg.semanalDia &&
    agora >= alvoDeHoje(cfg.semanalHora) &&
    ultimoSemanal !== hoje
  ) {
    ultimoSemanal = hoje;
    await enviarResumo('semanal');
  }
}

/** Inicia o agendador. Não dispara retroativamente slots que já passaram no boot. */
export function iniciarAgendadorResumos() {
  const cfg = obterConfigResumo();
  const agora = new Date();
  const hoje = chaveDia(agora);
  // Se o backend subiu depois do horário de hoje, marca como "já feito" pra não
  // mandar um resumo atrasado só por ter reiniciado.
  if (agora >= alvoDeHoje(cfg.diarioHora)) ultimoDiario = hoje;
  if (agora >= alvoDeHoje(cfg.semanalHora)) ultimoSemanal = hoje;

  setInterval(() => {
    verificarAgenda().catch((e) => console.error('[resumo] falha ao checar agenda:', e));
  }, 60_000);
  console.log('Agendador de resumos do Telegram iniciado');
}
