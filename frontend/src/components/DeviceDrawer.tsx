import { useEffect, useMemo, useState } from 'react';
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  api, Dispositivo, HeartbeatPayload, LIMIAR_PERDA_PCT, PingMetrica, StatusEvento, socket, saudeDispositivo,
} from '../api';
import { iconePorTipo } from './NetIcons';

type Janela = 60 | 360 | 1440;

const JANELAS: { valor: Janela; rotulo: string }[] = [
  { valor: 60, rotulo: '1h' },
  { valor: 360, rotulo: '6h' },
  { valor: 1440, rotulo: '24h' },
];

function formatarDuracao(seg: number): string {
  if (seg < 60) return `${Math.max(seg, 0)}s`;
  if (seg < 3600) return `${Math.floor(seg / 60)}min`;
  const h = Math.floor(seg / 3600);
  if (h < 24) return `${h}h ${Math.floor((seg % 3600) / 60)}min`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

function horaCurta(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function TooltipGrafico({ active, payload, label, unidade }: any) {
  if (!active || !payload?.length) return null;
  const v = payload[0].value;
  return (
    <div className="glass-panel px-3 py-2 !rounded-lg text-xs font-mono">
      <p className="text-muted">{horaCurta(label)}</p>
      <p className="text-slate-100 mt-0.5">
        {v === null || v === undefined ? 'sem resposta' : `${Number(v).toFixed(unidade === '%' ? 1 : 0)} ${unidade}`}
      </p>
    </div>
  );
}

function Stat({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
      <p className="text-[9px] uppercase tracking-[0.18em] text-muted font-mono mb-1">{rotulo}</p>
      {children}
    </div>
  );
}

export function DeviceDrawer({
  dispositivo,
  onClose,
}: {
  dispositivo: Dispositivo;
  onClose: () => void;
}) {
  const [janela, setJanela] = useState<Janela>(60);
  const [metricas, setMetricas] = useState<PingMetrica[]>([]);
  const [eventos, setEventos] = useState<StatusEvento[]>([]);
  const [, setTick] = useState(0);

  const saude = saudeDispositivo(dispositivo);
  const Icone = iconePorTipo('roteador');

  useEffect(() => {
    api.metricasDispositivo(dispositivo.id, janela).then(setMetricas).catch(() => setMetricas([]));
  }, [dispositivo.id, janela]);

  useEffect(() => {
    api.historicoDispositivo(dispositivo.id).then(setEventos).catch(() => setEventos([]));
  }, [dispositivo.id, dispositivo.status_atual]);

  // Gráfico cresce em tempo real: cada heartbeat do socket vira um ponto novo
  useEffect(() => {
    const aoReceber = (p: HeartbeatPayload) => {
      if (p.dispositivoId !== dispositivo.id || p.perdaPct === null) return;
      setMetricas((prev) => [
        ...prev.slice(-2000),
        { latencia_ms: p.latenciaMs, perda_pct: p.perdaPct!, timestamp: String(p.timestamp) },
      ]);
    };
    socket.on('heartbeat', aoReceber);
    socket.on('status_mudou', aoReceber);
    return () => {
      socket.off('heartbeat', aoReceber);
      socket.off('status_mudou', aoReceber);
    };
  }, [dispositivo.id]);

  // Relógio do uptime ("no ar há Xmin") avança sozinho
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [onClose]);

  const eventoAberto = eventos.find((e) => e.fim === null);
  const duracaoEstadoSeg = eventoAberto
    ? Math.floor((Date.now() - new Date(eventoAberto.inicio).getTime()) / 1000)
    : null;

  const ultimoEncerrado = eventos.find((e) => e.fim !== null);
  const quedas24h = useMemo(() => {
    const corte = Date.now() - 24 * 3600 * 1000;
    return eventos.filter((e) => e.status === 'offline' && new Date(e.inicio).getTime() >= corte).length;
  }, [eventos]);

  const corStatus = saude === 'offline' ? 'text-offline' : saude === 'degradado' ? 'text-warn' : 'text-online';
  const dotStatus =
    saude === 'offline'
      ? 'status-dot-offline animate-alert-blink'
      : saude === 'degradado'
        ? 'status-dot-warn animate-warn-pulse'
        : 'status-dot-online';

  return (
    <aside
      className="fixed inset-y-0 right-0 z-40 w-full max-w-[400px] flex flex-col
        bg-gradient-to-b from-deep-900/95 to-deep-950/95 backdrop-blur-2xl
        border-l border-white/10 shadow-glass animate-drawer-in"
      role="dialog"
      aria-label={`Detalhes de ${dispositivo.nome}`}
    >
      {/* cabeçalho */}
      <header className="flex items-start gap-3 p-5 border-b border-white/[0.06]">
        <span className={`flex items-center justify-center w-10 h-10 rounded-xl border shrink-0
          ${saude === 'offline' ? 'border-signal-500/50 bg-signal-600/15 text-signal-400' : 'border-white/15 bg-white/[0.05] text-online'}`}>
          <Icone width={20} height={20} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="eyebrow mb-0.5">Dispositivo monitorado</p>
          <h2 className="font-display font-semibold text-lg text-slate-100 leading-tight truncate">
            {dispositivo.nome}
          </h2>
          <p className="font-mono text-xs text-muted mt-0.5">{dispositivo.ip}</p>
        </div>
        <button
          onClick={onClose}
          aria-label="Fechar painel"
          className="text-muted hover:text-slate-100 rounded-lg hover:bg-white/[0.06] w-8 h-8 flex items-center justify-center transition-colors"
        >
          ✕
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        {/* estado atual */}
        <div className="grid grid-cols-2 gap-2.5">
          <Stat rotulo="Status">
            <span className="flex items-center gap-2">
              <span className={`inline-flex rounded-full w-2 h-2 ${dotStatus}`} />
              <span className={`font-mono text-sm uppercase tracking-wider ${corStatus}`}>
                {saude === 'degradado' ? 'degradado' : dispositivo.status_atual}
              </span>
            </span>
          </Stat>
          <Stat rotulo={dispositivo.status_atual === 'offline' ? 'Fora do ar há' : 'No ar há'}>
            <span className="stat-number text-sm">
              {duracaoEstadoSeg !== null ? formatarDuracao(duracaoEstadoSeg) : '—'}
            </span>
          </Stat>
          <Stat rotulo="Latência atual">
            <span className={`stat-number text-xl ${saude === 'degradado' ? 'text-warn' : ''}`}>
              {dispositivo.latencia_ms !== null ? `${Math.round(dispositivo.latencia_ms)}` : '—'}
              {dispositivo.latencia_ms !== null && <span className="text-xs text-muted ml-1">ms</span>}
            </span>
          </Stat>
          <Stat rotulo="Perda de pacotes">
            <span className={`stat-number text-xl ${(dispositivo.perda_pct ?? 0) >= LIMIAR_PERDA_PCT ? 'text-warn' : ''}`}>
              {dispositivo.perda_pct !== null ? dispositivo.perda_pct.toFixed(1) : '—'}
              {dispositivo.perda_pct !== null && <span className="text-xs text-muted ml-1">%</span>}
            </span>
          </Stat>
        </div>

        {/* seletor de janela */}
        <div className="flex items-center justify-between">
          <p className="eyebrow">Telemetria</p>
          <div className="flex rounded-lg border border-white/10 overflow-hidden">
            {JANELAS.map((j) => (
              <button
                key={j.valor}
                onClick={() => setJanela(j.valor)}
                className={`px-3 py-1 text-[11px] font-mono transition-colors ${
                  janela === j.valor ? 'bg-signal-600/25 text-signal-400' : 'text-muted hover:text-slate-200'
                }`}
              >
                {j.rotulo}
              </button>
            ))}
          </div>
        </div>

        {/* gráfico de latência */}
        <div>
          <p className="text-[10px] uppercase tracking-widest text-muted font-mono mb-2">Latência (ms)</p>
          <div className="h-36 rounded-xl border border-white/[0.06] bg-white/[0.02] p-2">
            {metricas.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={metricas} margin={{ top: 4, right: 4, bottom: 0, left: -14 }}>
                  <defs>
                    <linearGradient id="gradLatencia" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#FF2B3A" stopOpacity={0.45} />
                      <stop offset="100%" stopColor="#FF2B3A" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                  <XAxis
                    dataKey="timestamp"
                    tickFormatter={horaCurta}
                    tick={{ fill: '#82828E', fontSize: 9, fontFamily: '"IBM Plex Mono", monospace' }}
                    axisLine={false} tickLine={false} minTickGap={40}
                  />
                  <YAxis
                    tick={{ fill: '#82828E', fontSize: 9, fontFamily: '"IBM Plex Mono", monospace' }}
                    axisLine={false} tickLine={false} width={44}
                  />
                  <Tooltip content={<TooltipGrafico unidade="ms" />} />
                  <Area
                    type="monotone" dataKey="latencia_ms" stroke="#FF4D5A" strokeWidth={1.6}
                    fill="url(#gradLatencia)" connectNulls={false} isAnimationActive={false} dot={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-muted text-xs font-mono h-full flex items-center justify-center">
                aguardando amostras de ping…
              </p>
            )}
          </div>
        </div>

        {/* gráfico de perda */}
        <div>
          <p className="text-[10px] uppercase tracking-widest text-muted font-mono mb-2">Perda de pacotes (%)</p>
          <div className="h-28 rounded-xl border border-white/[0.06] bg-white/[0.02] p-2">
            {metricas.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={metricas} margin={{ top: 4, right: 4, bottom: 0, left: -14 }}>
                  <defs>
                    <linearGradient id="gradPerda" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#FFB224" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="#FFB224" stopOpacity={0.03} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                  <XAxis
                    dataKey="timestamp"
                    tickFormatter={horaCurta}
                    tick={{ fill: '#82828E', fontSize: 9, fontFamily: '"IBM Plex Mono", monospace' }}
                    axisLine={false} tickLine={false} minTickGap={40}
                  />
                  <YAxis
                    domain={[0, 100]}
                    tick={{ fill: '#82828E', fontSize: 9, fontFamily: '"IBM Plex Mono", monospace' }}
                    axisLine={false} tickLine={false} width={44}
                  />
                  <Tooltip content={<TooltipGrafico unidade="%" />} />
                  <Area
                    type="stepAfter" dataKey="perda_pct" stroke="#FFB224" strokeWidth={1.4}
                    fill="url(#gradPerda)" isAnimationActive={false} dot={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-muted text-xs font-mono h-full flex items-center justify-center">
                aguardando amostras de ping…
              </p>
            )}
          </div>
        </div>

        {/* resumo de eventos */}
        <div className="grid grid-cols-2 gap-2.5">
          <Stat rotulo="Quedas nas últimas 24h">
            <span className={`stat-number text-xl ${quedas24h > 0 ? 'text-offline' : ''}`}>{quedas24h}</span>
          </Stat>
          <Stat rotulo="Último evento">
            <span className="text-xs font-mono text-slate-300">
              {ultimoEncerrado
                ? `${ultimoEncerrado.status === 'offline' ? 'queda' : 'retorno'} · ${new Date(ultimoEncerrado.inicio).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`
                : 'sem registros'}
            </span>
          </Stat>
        </div>

        {/* timeline compacta */}
        <div>
          <p className="eyebrow mb-2">Linha do tempo</p>
          <div className="space-y-1">
            {eventos.slice(0, 8).map((e) => (
              <div
                key={e.id}
                className={`flex items-center justify-between px-3 py-1.5 rounded-lg border-l-2 text-xs font-mono ${
                  e.status === 'online' ? 'border-online/60 bg-white/[0.02]' : 'border-offline bg-signal-600/[0.07]'
                }`}
              >
                <span className={e.status === 'online' ? 'text-online' : 'text-offline'}>
                  {e.status === 'online' ? 'voltou' : 'caiu'}
                </span>
                <span className="text-muted">
                  {new Date(e.inicio).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </span>
                <span className="text-slate-300">
                  {e.duracao_segundos !== null ? formatarDuracao(e.duracao_segundos) : 'agora'}
                </span>
              </div>
            ))}
            {eventos.length === 0 && (
              <p className="text-muted text-xs font-mono">Nenhum evento registrado ainda.</p>
            )}
          </div>
        </div>

        {/* ficha técnica */}
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 text-[11px] font-mono text-muted space-y-1">
          <p>método · <span className="text-slate-300">{dispositivo.metodo_monitoramento}</span></p>
          <p>intervalo · <span className="text-slate-300">{dispositivo.intervalo_polling_seg}s</span></p>
          <p>fabricante · <span className="text-slate-300">{dispositivo.fabricante}</span></p>
        </div>
      </div>
    </aside>
  );
}
