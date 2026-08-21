import { useEffect, useId, useMemo, useState } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  api,
  HeartbeatPayload,
  LIMIAR_LATENCIA_MS,
  LIMIAR_PERDA_PCT,
  PingHistoryPoint,
  PingHistoryRange,
  socket,
} from '../api';

const PERIODOS: { value: PingHistoryRange; label: string; detalhe: string }[] = [
  { value: '24h', label: '24h', detalhe: '5 min' },
  { value: '7d', label: '7d', detalhe: 'hora' },
  { value: '30d', label: '30d', detalhe: 'hora' },
  { value: '90d', label: '90d', detalhe: 'dia' },
  { value: '1y', label: '1 ano', detalhe: 'dia' },
];

const TICK = { fill: '#82828E', fontSize: 9, fontFamily: '"IBM Plex Mono", monospace' };

function dataLocal(timestamp: string) {
  return new Date(timestamp);
}

function formatarEixo(timestamp: string, range: PingHistoryRange) {
  const data = dataLocal(timestamp);
  if (Number.isNaN(data.getTime())) return timestamp;
  if (range === '24h') return data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (range === '7d' || range === '30d') {
    return data.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit' });
  }
  return data.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

function formatarDataCompleta(timestamp: string) {
  const data = dataLocal(timestamp);
  if (Number.isNaN(data.getTime())) return timestamp;
  return data.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function timestampLocal(data: Date) {
  const dois = (valor: number) => String(valor).padStart(2, '0');
  return `${data.getFullYear()}-${dois(data.getMonth() + 1)}-${dois(data.getDate())}` +
    `T${dois(data.getHours())}:${dois(data.getMinutes())}:00`;
}

function TooltipHistorico({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-white/10 bg-[#081318]/95 px-3 py-2.5 shadow-2xl backdrop-blur-xl">
      <p className="mb-1.5 font-mono text-[10px] text-muted">{formatarDataCompleta(String(label))}</p>
      {payload.map((item: any) => (
        <p key={item.dataKey} className="flex items-center justify-between gap-5 font-mono text-[11px]">
          <span style={{ color: item.color }}>{item.name}</span>
          <span className="text-slate-100">
            {item.value === null || item.value === undefined ? 'sem resposta' : `${Number(item.value).toFixed(1)}${item.unit || ''}`}
          </span>
        </p>
      ))}
    </div>
  );
}

function Resumo({ label, valor, unidade, tom = 'text-slate-100' }: {
  label: string;
  valor: number | null;
  unidade: string;
  tom?: string;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-white/[0.07] bg-white/[0.025] px-3 py-2.5">
      <p className="truncate font-mono text-[9px] uppercase tracking-[0.16em] text-muted">{label}</p>
      <p className={`mt-1 font-mono text-lg font-semibold tabular-nums ${tom}`}>
        {valor === null ? '—' : valor.toFixed(valor >= 100 ? 0 : 1)}
        {valor !== null && <span className="ml-1 text-[10px] font-normal text-muted">{unidade}</span>}
      </p>
    </div>
  );
}

export function PingHistoryChart({
  empresaId,
  deviceId,
  title = 'Histórico de conectividade',
  compact = false,
}: {
  empresaId?: number;
  deviceId?: number;
  title?: string;
  compact?: boolean;
}) {
  const [range, setRange] = useState<PingHistoryRange>('24h');
  const [dados, setDados] = useState<PingHistoryPoint[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [tentativa, setTentativa] = useState(0);
  const gradientId = `latency-${useId().replace(/:/g, '')}`;

  useEffect(() => {
    let ativo = true;
    setCarregando(true);
    setErro('');
    const requisicao = deviceId
      ? api.historicoPingDispositivo(deviceId, range)
      : empresaId
        ? api.historicoPingEmpresa(empresaId, range)
        : Promise.resolve([]);

    requisicao
      .then((pontos) => ativo && setDados(pontos))
      .catch((falha) => {
        if (!ativo) return;
        setDados([]);
        setErro(falha instanceof Error ? falha.message : 'Não foi possível carregar o histórico.');
      })
      .finally(() => ativo && setCarregando(false));
    return () => { ativo = false; };
  }, [deviceId, empresaId, range, tentativa]);

  // No drawer, preserva a leitura ao vivo sem voltar a fazer um INSERT por ping.
  // O ponto corrente substitui apenas o ultimo balde de cinco minutos.
  useEffect(() => {
    if (!deviceId || range !== '24h') return;
    const aoVivo = (payload: HeartbeatPayload) => {
      if (payload.dispositivoId !== deviceId || payload.perdaPct === null) return;
      const data = new Date(payload.timestamp);
      data.setSeconds(0, 0);
      data.setMinutes(Math.floor(data.getMinutes() / 5) * 5);
      const online = (payload.statusNovo ?? payload.status) !== 'offline';
      const degradado = online && (
        (payload.latenciaMs !== null && payload.latenciaMs >= LIMIAR_LATENCIA_MS) ||
        payload.perdaPct >= LIMIAR_PERDA_PCT
      );
      const ponto: PingHistoryPoint = {
        timestamp: timestampLocal(data),
        avg_latency: payload.latenciaMs,
        min_latency: payload.latenciaMs,
        max_latency: payload.latenciaMs,
        packet_loss_pct: payload.perdaPct,
        uptime_pct: online ? 100 : 0,
        degraded_pct: degradado ? 100 : 0,
      };
      setDados((atuais) => {
        const ultimo = atuais[atuais.length - 1];
        if (ultimo?.timestamp.slice(0, 16) === ponto.timestamp.slice(0, 16)) {
          return [...atuais.slice(0, -1), ponto];
        }
        return [...atuais.slice(-287), ponto];
      });
    };
    socket.on('heartbeat', aoVivo);
    socket.on('status_mudou', aoVivo);
    return () => {
      socket.off('heartbeat', aoVivo);
      socket.off('status_mudou', aoVivo);
    };
  }, [deviceId, range]);

  const resumo = useMemo(() => {
    const medias = dados.map((ponto) => ponto.avg_latency).filter((valor): valor is number => valor !== null);
    const media = (valores: number[]) => valores.length
      ? valores.reduce((soma, valor) => soma + valor, 0) / valores.length
      : null;
    return {
      latencia: media(medias),
      perda: media(dados.map((ponto) => ponto.packet_loss_pct)),
      uptime: media(dados.map((ponto) => ponto.uptime_pct)),
      degradado: media(dados.map((ponto) => ponto.degraded_pct)),
    };
  }, [dados]);

  const granularidade = PERIODOS.find((periodo) => periodo.value === range)?.detalhe;
  const alturaLatencia = compact ? 172 : 230;
  const alturaQualidade = compact ? 142 : 190;

  return (
    <section className={`w-full min-w-0 max-w-full overflow-hidden rounded-2xl border border-teal-300/[0.10] bg-gradient-to-br from-[#0B171C]/95 via-[#081217]/95 to-deep-950 shadow-glass ${compact ? 'p-3' : 'p-4 sm:p-5'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="eyebrow mb-1">Telemetria temporal</p>
          <h2 className="font-display text-base font-semibold text-slate-100">{title}</h2>
          <p className="mt-1 font-mono text-[10px] text-muted">
            {range === '24h' ? 'amostras raw' : range === '7d' || range === '30d' ? 'rollup horário' : 'rollup diário'} · 1 ponto/{granularidade}
          </p>
        </div>
        <div className="flex flex-wrap gap-1 rounded-xl border border-white/[0.08] bg-black/20 p-1" aria-label="Período do histórico">
          {PERIODOS.map((periodo) => (
            <button
              key={periodo.value}
              type="button"
              onClick={() => setRange(periodo.value)}
              aria-pressed={range === periodo.value}
              className={`min-h-9 min-w-[44px] rounded-lg px-2.5 font-mono text-[10px] transition-colors focus:outline-none focus:ring-2 focus:ring-teal-400/60 ${
                range === periodo.value
                  ? 'bg-teal-300/15 text-teal-200 shadow-[inset_0_0_0_1px_rgba(94,234,212,0.22)]'
                  : 'text-muted hover:bg-white/[0.05] hover:text-slate-200'
              }`}
            >
              {periodo.label}
            </button>
          ))}
        </div>
      </div>

      <div className={`mt-4 grid gap-2 ${compact ? 'grid-cols-2' : 'grid-cols-2 lg:grid-cols-4'}`}>
        <Resumo label="Latência média" valor={resumo.latencia} unidade="ms" tom={(resumo.latencia ?? 0) >= LIMIAR_LATENCIA_MS ? 'text-warn' : 'text-teal-200'} />
        <Resumo label="Uptime" valor={resumo.uptime} unidade="%" tom={(resumo.uptime ?? 100) < 99 ? 'text-warn' : 'text-online'} />
        <Resumo label="Perda média" valor={resumo.perda} unidade="%" tom={(resumo.perda ?? 0) >= LIMIAR_PERDA_PCT ? 'text-warn' : 'text-slate-100'} />
        <Resumo label="Tempo degradado" valor={resumo.degradado} unidade="%" tom={(resumo.degradado ?? 0) > 0 ? 'text-warn' : 'text-slate-100'} />
      </div>

      {carregando ? (
        <div className="mt-4 grid gap-3" aria-live="polite">
          <div className="h-48 animate-pulse rounded-xl border border-white/[0.05] bg-white/[0.025]" />
          <p className="text-center font-mono text-[10px] text-muted">consultando série temporal…</p>
        </div>
      ) : erro ? (
        <div className="mt-4 flex min-h-44 flex-col items-center justify-center rounded-xl border border-offline/20 bg-offline/[0.04] px-4 text-center" role="alert">
          <p className="font-mono text-xs text-offline">{erro}</p>
          <button type="button" onClick={() => setTentativa((valor) => valor + 1)} className="btn-ghost mt-3">Tentar novamente</button>
        </div>
      ) : dados.length === 0 ? (
        <div className="mt-4 flex min-h-44 items-center justify-center rounded-xl border border-dashed border-white/10 bg-white/[0.015] px-4 text-center">
          <p className="font-mono text-xs text-muted">Ainda não há amostras neste período.</p>
        </div>
      ) : (
        <>
          <div className="mt-4">
            <p className="mb-2 font-mono text-[9px] uppercase tracking-[0.18em] text-muted">Latência · média, mínimo e máximo</p>
            <div className="rounded-xl border border-white/[0.06] bg-black/15 px-1 pt-2" style={{ height: alturaLatencia }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={dados} margin={{ top: 4, right: 10, bottom: 4, left: compact ? -18 : -8 }}>
                  <defs>
                    <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#2DD4BF" stopOpacity={0.30} />
                      <stop offset="100%" stopColor="#2DD4BF" stopOpacity={0.015} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="rgba(148,163,184,0.08)" vertical={false} />
                  <XAxis dataKey="timestamp" tickFormatter={(valor) => formatarEixo(valor, range)} tick={TICK} axisLine={false} tickLine={false} minTickGap={compact ? 52 : 70} />
                  <YAxis tick={TICK} axisLine={false} tickLine={false} width={48} unit="ms" />
                  <Tooltip content={<TooltipHistorico />} />
                  {!compact && <Legend iconType="plainline" wrapperStyle={{ fontSize: 10, fontFamily: 'IBM Plex Mono', color: '#94A3B8' }} />}
                  <Area type="monotone" dataKey="avg_latency" name="média" unit=" ms" stroke="#2DD4BF" strokeWidth={2} fill={`url(#${gradientId})`} connectNulls={false} isAnimationActive={false} dot={false} />
                  <Line type="monotone" dataKey="min_latency" name="mínima" unit=" ms" stroke="#64748B" strokeWidth={1} strokeDasharray="3 4" connectNulls isAnimationActive={false} dot={false} />
                  <Line type="monotone" dataKey="max_latency" name="máxima" unit=" ms" stroke="#F59E0B" strokeWidth={1} strokeDasharray="5 4" connectNulls isAnimationActive={false} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="mt-3">
            <p className="mb-2 font-mono text-[9px] uppercase tracking-[0.18em] text-muted">Qualidade · uptime e perda de pacotes</p>
            <div className="rounded-xl border border-white/[0.06] bg-black/15 px-1 pt-2" style={{ height: alturaQualidade }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={dados} margin={{ top: 4, right: 10, bottom: 4, left: compact ? -18 : -8 }}>
                  <CartesianGrid stroke="rgba(148,163,184,0.08)" vertical={false} />
                  <XAxis dataKey="timestamp" tickFormatter={(valor) => formatarEixo(valor, range)} tick={TICK} axisLine={false} tickLine={false} minTickGap={compact ? 52 : 70} />
                  <YAxis domain={[0, 100]} tick={TICK} axisLine={false} tickLine={false} width={48} unit="%" />
                  <Tooltip content={<TooltipHistorico />} />
                  {!compact && <Legend iconType="plainline" wrapperStyle={{ fontSize: 10, fontFamily: 'IBM Plex Mono', color: '#94A3B8' }} />}
                  <Line type="monotone" dataKey="uptime_pct" name="uptime" unit="%" stroke="#2FD771" strokeWidth={2} connectNulls isAnimationActive={false} dot={false} />
                  <Line type="stepAfter" dataKey="packet_loss_pct" name="perda" unit="%" stroke="#FFB224" strokeWidth={1.5} strokeDasharray="5 3" connectNulls isAnimationActive={false} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {!compact && (
            <details className="mt-3 rounded-xl border border-white/[0.06] bg-white/[0.015]">
              <summary className="cursor-pointer px-3 py-2 font-mono text-[10px] text-muted hover:text-slate-200">Ver dados do gráfico ({dados.length} pontos)</summary>
              <div className="max-h-64 overflow-auto border-t border-white/[0.06]">
                <table className="w-full min-w-[620px] text-left font-mono text-[10px]">
                  <thead className="sticky top-0 bg-[#0A151A] text-muted">
                    <tr><th className="px-3 py-2">Horário</th><th>Média</th><th>Mín.</th><th>Máx.</th><th>Perda</th><th>Uptime</th></tr>
                  </thead>
                  <tbody className="text-slate-300">
                    {dados.map((ponto) => (
                      <tr key={ponto.timestamp} className="border-t border-white/[0.04]">
                        <td className="px-3 py-1.5">{formatarDataCompleta(ponto.timestamp)}</td>
                        <td>{ponto.avg_latency?.toFixed(1) ?? '—'} ms</td><td>{ponto.min_latency?.toFixed(1) ?? '—'} ms</td><td>{ponto.max_latency?.toFixed(1) ?? '—'} ms</td><td>{ponto.packet_loss_pct.toFixed(1)}%</td><td>{ponto.uptime_pct.toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </>
      )}
    </section>
  );
}
