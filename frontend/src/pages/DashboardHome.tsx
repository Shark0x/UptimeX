import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api, DashboardData, DashboardRange, Empresa } from '../api';

const RANGES: { valor: DashboardRange; rotulo: string }[] = [
  { valor: '7d', rotulo: '7 dias' },
  { valor: '30d', rotulo: '30 dias' },
  { valor: '90d', rotulo: '90 dias' },
];

// Atualiza em paralelo ao restante do painel
const INTERVALO_ATUALIZACAO_MS = 30000;

// Cores de status da marca (fixas em todos os temas — legíveis em qualquer fundo).
// Espelham os tokens offline/warn do tailwind.config.js; Recharts precisa de hex.
const COR_OFFLINE = '#FF2B3A';
const COR_WARN = '#FFB224';

/** "3h 12min" / "12min" / "45s" a partir de segundos. */
function duracao(seg: number | null): string {
  if (seg == null) return '—';
  if (seg < 60) return `${Math.round(seg)}s`;
  const min = Math.floor(seg / 60);
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h < 24) return `${h}h${m > 0 ? ` ${m}min` : ''}`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

/** "há 12min" / "há 3h" / "há 2d" desde o início do incidente. */
function tempoDesde(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  return `há ${Math.floor(h / 24)}d`;
}

/** Data curta DD/MM a partir de YYYY-MM-DD. */
function diaCurto(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}

function Kpi({
  rotulo,
  valor,
  tom,
  destaque,
}: {
  rotulo: string;
  valor: string | number;
  tom?: 'offline' | 'online' | 'warn' | 'accent';
  destaque?: boolean;
}) {
  const cor =
    tom === 'offline'
      ? 'text-offline'
      : tom === 'online'
        ? 'text-online'
        : tom === 'warn'
          ? 'text-warn'
          : tom === 'accent'
            ? 'text-accent-400'
            : 'text-slate-100';
  return (
    <div
      className={`glass-panel px-4 py-3.5 flex-1 min-w-[130px] ${destaque ? 'hud-corners' : ''}`}
    >
      <p className={`stat-number text-3xl leading-none tabular-nums ${cor}`}>{valor}</p>
      <p className="text-[10px] uppercase tracking-widest text-muted font-mono mt-2">{rotulo}</p>
    </div>
  );
}

function TituloSecao({ eyebrow, titulo }: { eyebrow: string; titulo: string }) {
  return (
    <div className="mb-3">
      <p className="eyebrow">{eyebrow}</p>
      <h2 className="font-display font-semibold text-slate-100">{titulo}</h2>
    </div>
  );
}

export function DashboardHome({
  onSelecionarEmpresa,
  range,
  onRangeChange,
}: {
  onSelecionarEmpresa: (empresa: Empresa) => void;
  range: DashboardRange;
  onRangeChange: (range: DashboardRange) => void;
}) {
  const [dados, setDados] = useState<DashboardData | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async (r: DashboardRange) => {
    try {
      const d = await api.dashboard(r);
      setDados(d);
      setErro(null);
    } catch {
      setErro('Não foi possível carregar o painel. Tente novamente em instantes.');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    setCarregando(true);
    carregar(range);
    const id = window.setInterval(() => carregar(range), INTERVALO_ATUALIZACAO_MS);
    return () => window.clearInterval(id);
  }, [range, carregar]);

  function mudarRange(r: DashboardRange) {
    onRangeChange(r);
  }

  // Abre a empresa pelo painel; como o DashboardHome só tem id+nome, cria um
  // objeto Empresa mínimo — o painel recarrega os dados completos ao abrir.
  function abrirEmpresa(empresaId: number, nome: string) {
    onSelecionarEmpresa({ id: empresaId, nome } as Empresa);
  }

  const dadosGraficoQuedas = useMemo(
    () =>
      (dados?.quedasPorEmpresa ?? []).map((q) => ({
        nome: q.nome.length > 22 ? q.nome.slice(0, 20) + '…' : q.nome,
        nomeCompleto: q.nome,
        empresaId: q.empresaId,
        quedas: q.quedas,
      })),
    [dados]
  );

  const dadosGraficoTempo = useMemo(
    () =>
      (dados?.quedasNoTempo ?? []).map((q) => ({
        dia: diaCurto(q.dia),
        quedas: q.quedas,
        empresas: q.empresasAfetadas,
      })),
    [dados]
  );

  if (carregando && !dados) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-muted text-sm font-mono animate-pulse">Carregando painel…</p>
      </div>
    );
  }

  if (erro && !dados) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="glass-panel px-6 py-5 text-center">
          <p className="text-offline font-display">{erro}</p>
        </div>
      </div>
    );
  }

  const k = dados!.kpis;

  return (
    <div className="h-full overflow-y-auto pr-1">
      {/* Cabeçalho + filtro de período */}
      <header className="flex flex-wrap items-end justify-between gap-3 mb-5 animate-fade-up">
        <div>
          <p className="eyebrow mb-1">Visão geral · tempo real</p>
          <h1 className="font-display text-2xl font-semibold text-slate-100 tracking-tight">
            Painel
          </h1>
        </div>
        <div
          className="flex gap-1 glass-panel p-1 rounded-lg"
          role="group"
          aria-label="Período do painel"
        >
          {RANGES.map((r) => (
            <button
              key={r.valor}
              onClick={() => mudarRange(r.valor)}
              aria-pressed={range === r.valor}
              className={`px-3 py-1.5 text-xs font-mono rounded-md transition-all ${
                range === r.valor
                  ? 'bg-signal-600/20 text-signal-400 border border-signal-500/40'
                  : 'text-muted hover:text-slate-200 border border-transparent'
              }`}
            >
              {r.rotulo}
            </button>
          ))}
        </div>
      </header>

      {/* KPIs */}
      <div className="flex flex-wrap gap-3 mb-6 animate-fade-up">
        <Kpi rotulo="empresas" valor={k.totalEmpresas} destaque />
        <Kpi rotulo="online agora" valor={k.online} tom="online" />
        <Kpi rotulo="degradadas" valor={k.degradadas} tom={k.degradadas > 0 ? 'warn' : undefined} />
        <Kpi rotulo="offline" valor={k.offline} tom={k.offline > 0 ? 'offline' : undefined} />
        <Kpi
          rotulo="incidentes abertos"
          valor={k.incidentesAbertos}
          tom={k.incidentesAbertos > 0 ? 'accent' : undefined}
        />
      </div>

      {/* Gráficos lado a lado */}
      <div className="grid lg:grid-cols-2 gap-4 mb-6 animate-fade-up">
        {/* Quedas por empresa */}
        <section className="glass-panel hud-corners p-5">
          <TituloSecao eyebrow={`Período · ${range}`} titulo="Quedas por empresa" />
          {dadosGraficoQuedas.length === 0 ? (
            <p className="text-muted text-sm font-mono py-12 text-center">
              Nenhuma queda registrada no período.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart
                data={dadosGraficoQuedas}
                layout="vertical"
                margin={{ top: 4, right: 16, bottom: 4, left: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-white/5" />
                <XAxis
                  type="number"
                  tick={{ fontSize: 11, fontFamily: 'monospace' }}
                  stroke="currentColor"
                  className="text-muted"
                  allowDecimals={false}
                />
                <YAxis
                  type="category"
                  dataKey="nome"
                  width={130}
                  tick={{ fontSize: 11, fontFamily: 'monospace' }}
                  stroke="currentColor"
                  className="text-muted"
                />
                <Tooltip
                  cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                  contentStyle={{
                    background: 'rgba(15,23,42,0.95)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 8,
                    fontSize: 12,
                    fontFamily: 'monospace',
                  }}
                  formatter={(v: number) => [`${v} quedas`, '']}
                  labelFormatter={(_, p) => p?.[0]?.payload?.nomeCompleto ?? ''}
                />
                <Bar dataKey="quedas" radius={[0, 4, 4, 0]} cursor="pointer">
                  {dadosGraficoQuedas.map((d) => (
                    <Cell
                      key={d.empresaId}
                      fill={COR_OFFLINE}
                      onClick={() => abrirEmpresa(d.empresaId, d.nomeCompleto)}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </section>

        {/* Quedas ao longo do tempo */}
        <section className="glass-panel hud-corners p-5">
          <TituloSecao eyebrow="Novas quedas por dia" titulo="Quedas ao longo do tempo" />
          {dadosGraficoTempo.length === 0 ? (
            <p className="text-muted text-sm font-mono py-12 text-center">
              Nenhuma queda registrada no período.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={dadosGraficoTempo} margin={{ top: 4, right: 8, bottom: 4, left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-white/5" />
                <XAxis
                  dataKey="dia"
                  tick={{ fontSize: 10, fontFamily: 'monospace' }}
                  stroke="currentColor"
                  className="text-muted"
                  interval="preserveStartEnd"
                  minTickGap={20}
                />
                <YAxis
                  tick={{ fontSize: 11, fontFamily: 'monospace' }}
                  stroke="currentColor"
                  className="text-muted"
                  allowDecimals={false}
                />
                <Tooltip
                  cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                  contentStyle={{
                    background: 'rgba(15,23,42,0.95)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 8,
                    fontSize: 12,
                    fontFamily: 'monospace',
                  }}
                  formatter={(v: number, nome) => [
                    nome === 'quedas' ? `${v} quedas` : `${v} empresas`,
                    '',
                  ]}
                />
                <Bar dataKey="quedas" fill={COR_WARN} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </section>
      </div>

      {/* Ranking + Incidentes lado a lado */}
      <div className="grid lg:grid-cols-2 gap-4 animate-fade-up">
        {/* Ranking: menor uptime */}
        <section className="glass-panel p-5">
          <TituloSecao eyebrow={`Menor disponibilidade · ${range}`} titulo="Ranking de uptime" />
          {dados!.rankingUptime.length === 0 ? (
            <p className="text-muted text-sm font-mono py-8 text-center">
              Todas as empresas com disponibilidade total no período.
            </p>
          ) : (
            <ul className="divide-y divide-white/[0.06]">
              {dados!.rankingUptime.map((r, i) => (
                <li key={r.empresaId}>
                  <button
                    onClick={() => abrirEmpresa(r.empresaId, r.nome)}
                    className="w-full flex items-center justify-between gap-3 py-2.5 text-left hover:bg-white/[0.03] -mx-2 px-2 rounded transition-colors"
                  >
                    <span className="flex items-center gap-3 min-w-0">
                      <span className="text-[11px] font-mono text-muted tabular-nums w-5 shrink-0">
                        {i + 1}
                      </span>
                      <span className="font-display text-sm text-slate-200 truncate">{r.nome}</span>
                    </span>
                    <span className="flex items-center gap-3 shrink-0">
                      <span className="text-[11px] font-mono text-muted tabular-nums">
                        {duracao(r.downtimeSeg)} fora
                      </span>
                      <span
                        className={`text-sm font-mono tabular-nums font-semibold w-16 text-right ${
                          (r.uptimePct ?? 100) < 90
                            ? 'text-offline'
                            : (r.uptimePct ?? 100) < 99
                              ? 'text-warn'
                              : 'text-online'
                        }`}
                      >
                        {r.uptimePct != null ? `${r.uptimePct.toFixed(1)}%` : '—'}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Incidentes recentes */}
        <section className="glass-panel p-5">
          <TituloSecao eyebrow="Abertos primeiro" titulo="Incidentes recentes" />
          {dados!.incidentesRecentes.length === 0 ? (
            <p className="text-muted text-sm font-mono py-8 text-center">
              Nenhum incidente no período.
            </p>
          ) : (
            <ul className="divide-y divide-white/[0.06]">
              {dados!.incidentesRecentes.map((inc, i) => (
                <li key={`${inc.empresaId}-${inc.inicio}-${i}`}>
                  <button
                    onClick={() => abrirEmpresa(inc.empresaId, inc.empresaNome)}
                    className="w-full flex items-center justify-between gap-3 py-2.5 text-left hover:bg-white/[0.03] -mx-2 px-2 rounded transition-colors"
                  >
                    <span className="flex items-start gap-2.5 min-w-0">
                      <span className="relative flex w-2 h-2 shrink-0 mt-1.5">
                        {inc.emAndamento && (
                          <span className="absolute inline-flex h-full w-full rounded-full bg-offline/50 animate-sonar" />
                        )}
                        <span
                          className={`relative inline-flex rounded-full w-2 h-2 ${
                            inc.emAndamento ? 'bg-offline' : 'bg-muted'
                          }`}
                        />
                      </span>
                      <span className="min-w-0">
                        <span className="block font-display text-sm text-slate-200 truncate">
                          {inc.empresaNome}
                        </span>
                        <span className="block text-[11px] font-mono text-muted truncate">
                          {inc.dispositivo}
                        </span>
                      </span>
                    </span>
                    <span className="text-right shrink-0">
                      {inc.emAndamento ? (
                        <>
                          <span className="block text-[11px] font-mono text-offline">
                            em andamento
                          </span>
                          <span className="block text-[10px] font-mono text-muted tabular-nums">
                            {tempoDesde(inc.inicio)}
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="block text-[11px] font-mono text-muted">encerrado</span>
                          <span className="block text-[10px] font-mono text-muted tabular-nums">
                            {duracao(inc.duracaoSeg)}
                          </span>
                        </>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
