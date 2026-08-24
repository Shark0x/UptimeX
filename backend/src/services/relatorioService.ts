import { pool } from '../db/pool';
import {
  consultarHistoricoPingEmpresa,
  PING_HISTORY_RANGES,
  PingHistoryPoint,
  PingHistoryRange,
} from './pingHistoryService';

// Limiares de degradação — os mesmos usados no frontend (api.ts) e no resumo-status.
const LIMIAR_LATENCIA_MS = Number(process.env.PING_DEGRADED_LATENCY_MS) || 150;
const LIMIAR_PERDA_PCT = Number(process.env.PING_DEGRADED_PACKET_LOSS_PCT) || 2;

// Teto de linhas de queda no extrato: janelas longas com muitos dispositivos
// poderiam gerar payloads enormes. 1000 cobre com folga um relatório mensal.
const MAX_QUEDAS = 1000;

const ROTULOS_RANGE: Readonly<Record<PingHistoryRange, string>> = {
  '24h': 'Últimas 24 horas',
  '7d': 'Últimos 7 dias',
  '30d': 'Últimos 30 dias',
  '90d': 'Últimos 90 dias',
  '1y': 'Último ano',
};

export interface QuedaRelatorio {
  dispositivo: string;
  inicio: string;
  fim: string | null;
  duracao_segundos: number | null;
  em_andamento: boolean;
}

export interface RelatorioEmpresa {
  empresa: { id: number; nome: string; endereco: string | null };
  periodo: {
    range: PingHistoryRange;
    label: string;
    inicio: string;
    fim: string;
    gerado_em: string;
  };
  kpis: {
    disponibilidade_pct: number | null;
    degradado_pct: number | null;
    latencia_media: number | null;
    latencia_p95: number | null;
    latencia_max: number | null;
    perda_media: number | null;
    perda_max: number | null;
    total_quedas: number;
    tempo_total_offline_seg: number;
    mttr_seg: number | null;
    maior_queda_seg: number | null;
    dispositivos_monitorados: number;
  };
  serie: PingHistoryPoint[];
  quedas: QuedaRelatorio[];
  por_dispositivo: Array<{ dispositivo: string; quedas: number; tempo_offline_seg: number }>;
  limiares: { latencia_ms: number; perda_pct: number };
}

function media(valores: number[]): number | null {
  const arr = valores.filter((v) => Number.isFinite(v));
  if (arr.length === 0) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function maximo(valores: number[]): number | null {
  const arr = valores.filter((v) => Number.isFinite(v));
  return arr.length === 0 ? null : Math.max(...arr);
}

// Percentil pelo "nearest-rank" sobre a latência média de cada intervalo. Não é o
// p95 das amostras cruas (que exigiria varrer o ping_log inteiro), e sim o p95 da
// latência média por balde — métrica estável e honesta pro extrato mensal.
function percentil(valores: number[], p: number): number | null {
  const arr = valores.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (arr.length === 0) return null;
  const idx = Math.ceil((p / 100) * arr.length) - 1;
  return arr[Math.min(arr.length - 1, Math.max(0, idx))];
}

function arredondar(valor: number | null, casas = 2): number | null {
  if (valor === null || !Number.isFinite(valor)) return null;
  const f = 10 ** casas;
  return Math.round(valor * f) / f;
}

export async function gerarRelatorioEmpresa(
  empresaId: number,
  range: PingHistoryRange
): Promise<RelatorioEmpresa | null> {
  const [empresas]: any = await pool.query(
    `SELECT id, nome, endereco FROM empresas WHERE id = ? LIMIT 1`,
    [empresaId]
  );
  if (empresas.length === 0) return null;
  const empresa = empresas[0];

  const config = PING_HISTORY_RANGES[range];
  const agora = new Date();
  const inicio = new Date(agora.getTime() - config.durationMs);

  const serie = await consultarHistoricoPingEmpresa(empresaId, range);

  // Quedas (eventos offline) iniciadas dentro da janela, com o nome do dispositivo.
  // duracao_segundos vem nulo enquanto a queda está aberta — nesse caso medimos
  // o tempo decorrido até agora, marcando em_andamento pra deixar claro no extrato.
  const [linhasQuedas]: any = await pool.query(
    `SELECT d.nome AS dispositivo,
            se.inicio,
            se.fim,
            COALESCE(
              se.duracao_segundos,
              FLOOR(EXTRACT(EPOCH FROM (NOW() - se.inicio)))
            )::int AS duracao_segundos,
            (se.fim IS NULL) AS em_andamento
     FROM status_eventos se
     JOIN dispositivos d ON d.id = se.dispositivo_id
     WHERE d.empresa_id = ? AND se.status = 'offline' AND se.inicio >= ?
     ORDER BY se.inicio DESC
     LIMIT ?`,
    [empresaId, inicio, MAX_QUEDAS]
  );

  const quedas: QuedaRelatorio[] = linhasQuedas.map((l: any) => ({
    dispositivo: String(l.dispositivo),
    inicio: String(l.inicio),
    fim: l.fim === null ? null : String(l.fim),
    duracao_segundos: l.duracao_segundos === null ? null : Number(l.duracao_segundos),
    em_andamento: l.em_andamento === true || l.em_andamento === 't' || l.em_andamento === 1,
  }));

  const [{ total: dispositivosMonitorados }]: any = (
    await pool.query(
      `SELECT COUNT(*)::int AS total FROM dispositivos WHERE empresa_id = ? AND ativo = TRUE`,
      [empresaId]
    )
  )[0];

  // --- KPIs de latência/disponibilidade a partir da série consolidada da empresa ---
  const latMedias = serie.map((p) => p.avg_latency).filter((v): v is number => v !== null);
  const latMaximas = serie.map((p) => p.max_latency).filter((v): v is number => v !== null);
  const perdas = serie.map((p) => p.packet_loss_pct);
  const uptimes = serie.map((p) => p.uptime_pct);
  const degradados = serie.map((p) => p.degraded_pct);

  const duracoes = quedas.map((q) => q.duracao_segundos ?? 0);
  const duracoesFechadas = quedas
    .filter((q) => !q.em_andamento && q.duracao_segundos !== null)
    .map((q) => q.duracao_segundos as number);
  const tempoTotalOffline = duracoes.reduce((a, b) => a + b, 0);

  // Disponibilidade: preferimos a média da série (dado de ping real por intervalo).
  // Sem série (empresa nova ou sem pings no período), caímos pro cálculo por eventos.
  let disponibilidade = media(uptimes);
  if (disponibilidade === null) {
    const segPeriodo = config.durationMs / 1000;
    disponibilidade = segPeriodo > 0
      ? Math.max(0, 100 - (tempoTotalOffline / segPeriodo) * 100)
      : null;
  }

  const porDispositivoMapa = new Map<string, { quedas: number; tempo_offline_seg: number }>();
  for (const q of quedas) {
    const atual = porDispositivoMapa.get(q.dispositivo) || { quedas: 0, tempo_offline_seg: 0 };
    atual.quedas += 1;
    atual.tempo_offline_seg += q.duracao_segundos ?? 0;
    porDispositivoMapa.set(q.dispositivo, atual);
  }
  const porDispositivo = [...porDispositivoMapa.entries()]
    .map(([dispositivo, v]) => ({ dispositivo, ...v }))
    .sort((a, b) => b.tempo_offline_seg - a.tempo_offline_seg);

  return {
    empresa: { id: Number(empresa.id), nome: String(empresa.nome), endereco: empresa.endereco ?? null },
    periodo: {
      range,
      label: ROTULOS_RANGE[range],
      inicio: inicio.toISOString(),
      fim: agora.toISOString(),
      gerado_em: agora.toISOString(),
    },
    kpis: {
      disponibilidade_pct: arredondar(disponibilidade, 3),
      degradado_pct: arredondar(media(degradados)),
      latencia_media: arredondar(media(latMedias)),
      latencia_p95: arredondar(percentil(latMedias, 95)),
      latencia_max: arredondar(maximo(latMaximas)),
      perda_media: arredondar(media(perdas)),
      perda_max: arredondar(maximo(perdas)),
      total_quedas: quedas.length,
      tempo_total_offline_seg: tempoTotalOffline,
      mttr_seg: duracoesFechadas.length ? Math.round(media(duracoesFechadas) as number) : null,
      maior_queda_seg: duracoes.length ? Math.max(...duracoes) : null,
      dispositivos_monitorados: Number(dispositivosMonitorados) || 0,
    },
    serie,
    quedas,
    por_dispositivo: porDispositivo,
    limiares: { latencia_ms: LIMIAR_LATENCIA_MS, perda_pct: LIMIAR_PERDA_PCT },
  };
}
