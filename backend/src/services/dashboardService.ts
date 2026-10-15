import { pool } from '../db/pool';
import { PrincipalTenant, filtroEmpresaSql } from '../security/tenantAccess';

/**
 * Serviço agregado da Home (dashboard macro global). Reúne KPIs, quedas por
 * empresa, quedas ao longo do tempo, ranking e incidentes recentes numa única
 * consulta tenant-safe, evitando N+1 no frontend.
 *
 * Períodos suportados: 7d, 30d (hourly) e 90d (daily). Respeita o escopo RLS
 * via filtroEmpresaSql, idêntico às demais rotas de empresas.
 */

export type DashboardRange = '7d' | '30d' | '90d';

interface RangeConfig {
  durationMs: number;
}

const RANGES: Readonly<Record<DashboardRange, RangeConfig>> = Object.freeze({
  '7d': { durationMs: 7 * 24 * 60 * 60 * 1_000 },
  '30d': { durationMs: 30 * 24 * 60 * 60 * 1_000 },
  '90d': { durationMs: 90 * 24 * 60 * 60 * 1_000 },
});

export function normalizarRangeDashboard(valor: unknown): DashboardRange | null {
  const range = String(valor || '30d') as DashboardRange;
  return Object.prototype.hasOwnProperty.call(RANGES, range) ? range : null;
}

export interface DashboardKpis {
  totalEmpresas: number;
  online: number;
  degradadas: number;
  offline: number;
  incidentesAbertos: number;
}

export interface QuedaPorEmpresa {
  empresaId: number;
  nome: string;
  quedas: number;
  downtimeSeg: number;
}

export interface QuedaNoTempo {
  dia: string; // YYYY-MM-DD
  quedas: number;
  empresasAfetadas: number;
}

export interface RankingUptime {
  empresaId: number;
  nome: string;
  uptimePct: number | null;
  downtimeSeg: number;
}

export interface IncidenteRecente {
  empresaId: number;
  empresaNome: string;
  dispositivo: string;
  ip: string;
  inicio: string;
  fim: string | null;
  duracaoSeg: number | null;
  emAndamento: boolean;
}

export interface DashboardData {
  range: DashboardRange;
  kpis: DashboardKpis;
  quedasPorEmpresa: QuedaPorEmpresa[];
  quedasNoTempo: QuedaNoTempo[];
  rankingUptime: RankingUptime[];
  incidentesRecentes: IncidenteRecente[];
}

export async function montarDashboard(
  usuario: PrincipalTenant,
  range: DashboardRange
): Promise<DashboardData> {
  const config = RANGES[range];
  const desde = new Date(Date.now() - config.durationMs);
  const escopo = filtroEmpresaSql(usuario, 'e.id');

  // ---- KPIs: contagem de empresas por estado atual (dispositivos) ----
  // Classificação alinhada com /resumo-status: /30 é estado neutro (não offline).
  // Uma empresa é considerada:
  //   - offline: tem dispositivo offline (e não é /30 neutro)
  //   - degradada: tem dispositivo online degradado (lat>=150 ou perda>=2%)
  //   - online: todos os dispositivos no ar sem degradação
  const [kpiRows]: any = await pool.query(
    `
    WITH empresa_estado AS (
      SELECT
        e.id,
        EXISTS(SELECT 1 FROM links_dedicados l30 WHERE l30.empresa_id = e.id
          AND (l30.bloco::text LIKE '%/30' OR masklen(l30.bloco) = 30)) AS eh_30,
        COUNT(d.id) AS total,
        SUM(CASE WHEN d.status_atual = 'offline' THEN 1 ELSE 0 END) AS offline,
        SUM(CASE WHEN d.status_atual = 'online'
          AND (d.latencia_ms >= 150 OR d.perda_pct >= 2) THEN 1 ELSE 0 END) AS degradados
      FROM empresas e
      LEFT JOIN dispositivos d ON d.empresa_id = e.id AND d.ativo = TRUE
      WHERE ${escopo.sql}
      GROUP BY e.id
    )
    SELECT
      COUNT(*) AS total_empresas,
      COUNT(*) FILTER (WHERE total > 0 AND offline > 0 AND NOT eh_30) AS offline,
      COUNT(*) FILTER (WHERE total > 0 AND (offline = 0 OR eh_30) AND degradados > 0) AS degradadas,
      COUNT(*) FILTER (WHERE total > 0 AND (offline = 0 OR eh_30) AND degradados = 0) AS online
    FROM empresa_estado
    `,
    escopo.params
  );

  // Incidentes abertos (quedas sem fim) dentro do escopo
  const [incAbertos]: any = await pool.query(
    `
    SELECT COUNT(*) AS abertos
    FROM status_eventos se
    JOIN dispositivos d ON d.id = se.dispositivo_id
    JOIN empresas e ON e.id = d.empresa_id
    WHERE se.status = 'offline' AND se.fim IS NULL AND d.ativo = TRUE
      AND ${escopo.sql}
    `,
    escopo.params
  );

  const kpis: DashboardKpis = {
    totalEmpresas: Number(kpiRows[0]?.total_empresas ?? 0),
    online: Number(kpiRows[0]?.online ?? 0),
    degradadas: Number(kpiRows[0]?.degradadas ?? 0),
    offline: Number(kpiRows[0]?.offline ?? 0),
    incidentesAbertos: Number(incAbertos[0]?.abertos ?? 0),
  };

  // ---- Quedas por empresa: nº de eventos offline iniciados no período ----
  const [quedasEmp]: any = await pool.query(
    `
    SELECT e.id AS empresa_id, e.nome,
           COUNT(*) AS quedas,
           COALESCE(SUM(se.duracao_segundos), 0) AS downtime_seg
    FROM status_eventos se
    JOIN dispositivos d ON d.id = se.dispositivo_id
    JOIN empresas e ON e.id = d.empresa_id
    WHERE se.status = 'offline' AND se.inicio >= ?
      AND ${escopo.sql}
    GROUP BY e.id, e.nome
    ORDER BY quedas DESC, downtime_seg DESC
    LIMIT 10
    `,
    [desde, ...escopo.params]
  );

  const quedasPorEmpresa: QuedaPorEmpresa[] = (quedasEmp as any[]).map((r) => ({
    empresaId: Number(r.empresa_id),
    nome: String(r.nome),
    quedas: Number(r.quedas),
    downtimeSeg: Number(r.downtime_seg),
  }));

  // ---- Quedas ao longo do tempo: agrupadas por dia ----
  const [quedasTempo]: any = await pool.query(
    `
    SELECT to_char(date_trunc('day', se.inicio), 'YYYY-MM-DD') AS dia,
           COUNT(*) AS quedas,
           COUNT(DISTINCT d.empresa_id) AS empresas_afetadas
    FROM status_eventos se
    JOIN dispositivos d ON d.id = se.dispositivo_id
    JOIN empresas e ON e.id = d.empresa_id
    WHERE se.status = 'offline' AND se.inicio >= ?
      AND ${escopo.sql}
    GROUP BY 1
    ORDER BY 1 ASC
    `,
    [desde, ...escopo.params]
  );

  const quedasNoTempo: QuedaNoTempo[] = (quedasTempo as any[]).map((r) => ({
    dia: String(r.dia),
    quedas: Number(r.quedas),
    empresasAfetadas: Number(r.empresas_afetadas),
  }));

  // ---- Ranking de uptime: menor disponibilidade no período ----
  // Usa downtime acumulado por empresa / janela total do período.
  // Ordem dos parâmetros segue a ordem TEXTUAL dos placeholders (pool traduz
  // ? → $1,$2,… na ordem em que aparecem): SELECT, JOIN, WHERE(escopo), HAVING.
  const [rankingRows]: any = await pool.query(
    `
    SELECT e.id AS empresa_id, e.nome,
           COALESCE(SUM(
             GREATEST(0, EXTRACT(EPOCH FROM (
               LEAST(COALESCE(se.fim, NOW()), NOW()) - GREATEST(se.inicio, ?)
             )))
           ), 0) AS downtime_seg
    FROM empresas e
    LEFT JOIN dispositivos d ON d.empresa_id = e.id AND d.ativo = TRUE
    LEFT JOIN status_eventos se ON se.dispositivo_id = d.id
      AND se.status = 'offline' AND COALESCE(se.fim, NOW()) > ?
    WHERE ${escopo.sql}
    GROUP BY e.id, e.nome
    HAVING COALESCE(SUM(
             GREATEST(0, EXTRACT(EPOCH FROM (
               LEAST(COALESCE(se.fim, NOW()), NOW()) - GREATEST(se.inicio, ?)
             )))
           ), 0) > 0
    ORDER BY downtime_seg DESC
    LIMIT 10
    `,
    [desde, desde, ...escopo.params, desde]
  );

  const janelaSeg = config.durationMs / 1000;
  const rankingUptime: RankingUptime[] = (rankingRows as any[]).map((r) => {
    const downtimeSeg = Number(r.downtime_seg);
    const uptimePct = janelaSeg > 0 ? Math.max(0, 100 * (1 - downtimeSeg / janelaSeg)) : null;
    return {
      empresaId: Number(r.empresa_id),
      nome: String(r.nome),
      uptimePct: uptimePct !== null ? Math.round(uptimePct * 100) / 100 : null,
      downtimeSeg,
    };
  });

  // ---- Incidentes recentes: abertos primeiro, depois encerrados ----
  const [incidentes]: any = await pool.query(
    `
    SELECT e.id AS empresa_id, e.nome AS empresa_nome,
           d.nome AS dispositivo, d.ip,
           to_char(se.inicio, 'YYYY-MM-DD"T"HH24:MI:SS') AS inicio,
           CASE WHEN se.fim IS NULL THEN NULL
                ELSE to_char(se.fim, 'YYYY-MM-DD"T"HH24:MI:SS') END AS fim,
           se.duracao_segundos AS duracao_seg,
           (se.fim IS NULL) AS em_andamento
    FROM status_eventos se
    JOIN dispositivos d ON d.id = se.dispositivo_id
    JOIN empresas e ON e.id = d.empresa_id
    WHERE se.status = 'offline' AND se.inicio >= ?
      AND ${escopo.sql}
    ORDER BY (se.fim IS NULL) DESC, se.inicio DESC
    LIMIT 15
    `,
    [desde, ...escopo.params]
  );

  const incidentesRecentes: IncidenteRecente[] = (incidentes as any[]).map((r) => ({
    empresaId: Number(r.empresa_id),
    empresaNome: String(r.empresa_nome),
    dispositivo: String(r.dispositivo),
    ip: String(r.ip),
    inicio: String(r.inicio),
    fim: r.fim ? String(r.fim) : null,
    duracaoSeg: r.duracao_seg != null ? Number(r.duracao_seg) : null,
    emAndamento: Boolean(r.em_andamento),
  }));

  return {
    range,
    kpis,
    quedasPorEmpresa,
    quedasNoTempo,
    rankingUptime,
    incidentesRecentes,
  };
}
