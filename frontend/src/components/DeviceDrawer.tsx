import { useEffect, useMemo, useState } from 'react';
import {
  api, Dispositivo, LIMIAR_PERDA_PCT, StatusEvento, saudeDispositivo,
} from '../api';
import { iconePorTipo } from './NetIcons';
import { PingHistoryChart } from './PingHistoryChart';

function formatarDuracao(seg: number): string {
  if (seg < 60) return `${Math.max(seg, 0)}s`;
  if (seg < 3600) return `${Math.floor(seg / 60)}min`;
  const h = Math.floor(seg / 3600);
  if (h < 24) return `${h}h ${Math.floor((seg % 3600) / 60)}min`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
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
  const [eventos, setEventos] = useState<StatusEvento[]>([]);
  const [, setTick] = useState(0);

  const saude = saudeDispositivo(dispositivo);
  const Icone = iconePorTipo('roteador');

  useEffect(() => {
    api.historicoDispositivo(dispositivo.id).then(setEventos).catch(() => setEventos([]));
  }, [dispositivo.id, dispositivo.status_atual]);

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

        <PingHistoryChart
          deviceId={dispositivo.id}
          title="Histórico do dispositivo"
          compact
        />

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
