import { Dispositivo, LIMIAR_LATENCIA_MS, LIMIAR_PERDA_PCT, saudeDispositivo } from '../api';

function tempoDesde(dataStr: string | null): string {
  if (!dataStr) return '—';
  const diffMs = Date.now() - new Date(dataStr).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `${min}min atrás`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h atrás`;
  return `${Math.floor(h / 24)}d atrás`;
}

export function StatusCard({
  d,
  onAbrir,
  onEditar,
}: {
  d: Dispositivo;
  onAbrir?: () => void;
  onEditar?: () => void;
}) {
  const saude = saudeDispositivo(d);
  const offline = saude === 'offline';
  const degradado = saude === 'degradado';

  return (
    <button
      onClick={onAbrir}
      className={`group glass-panel w-full text-left p-4 transition-all duration-200 hover:-translate-y-0.5
        ${offline ? 'border-signal-500/60 animate-alert-pulse' : 'hover:border-white/20'}
        ${onAbrir ? 'cursor-pointer' : 'cursor-default'}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-display font-semibold text-slate-100 text-sm tracking-wide truncate">{d.nome}</p>
          <p className="font-mono text-xs text-muted mt-0.5">{d.ip}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {onEditar && (
            <span
              role="button"
              tabIndex={0}
              aria-label={`Editar ${d.nome}`}
              onClick={(e) => {
                e.stopPropagation();
                onEditar();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.stopPropagation();
                  onEditar();
                }
              }}
              className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-muted hover:text-signal-400
                w-6 h-6 flex items-center justify-center rounded-md hover:bg-white/[0.06] transition-all text-xs"
            >
              ✎
            </span>
          )}
          <span className="relative flex items-center justify-center w-4 h-4">
            {saude === 'online' && (
              <span className="absolute inline-flex h-full w-full rounded-full bg-online/30 animate-sonar" />
            )}
            <span
              className={`relative inline-flex rounded-full w-2.5 h-2.5 ${
                offline
                  ? 'status-dot-offline animate-alert-blink'
                  : degradado
                    ? 'status-dot-warn animate-warn-pulse'
                    : 'status-dot-online'
              }`}
            />
          </span>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between text-xs font-mono">
        <span className={offline ? 'text-offline' : degradado ? 'text-warn' : 'text-online'}>
          {offline ? 'OFFLINE' : degradado ? 'DEGRADADO' : 'ONLINE'}
        </span>
        <span className="text-muted">{tempoDesde(d.ultima_verificacao)}</span>
      </div>

      <div className="mt-2.5 pt-2.5 border-t border-white/[0.06] flex items-center justify-between">
        <span className="text-[11px] font-mono tabular-nums text-slate-300">
          {d.latencia_ms !== null && !offline ? (
            <>
              <span className={degradado && d.latencia_ms >= LIMIAR_LATENCIA_MS ? 'text-warn' : ''}>{Math.round(d.latencia_ms)} ms</span>
              <span className="text-muted"> · </span>
              <span className={(d.perda_pct ?? 0) >= LIMIAR_PERDA_PCT ? 'text-warn' : 'text-muted'}>
                {(d.perda_pct ?? 0).toFixed(0)}% perda
              </span>
            </>
          ) : (
            <span className="text-muted">{offline ? 'sem resposta' : 'sem métricas'}</span>
          )}
        </span>
        <span className="text-[9px] uppercase tracking-widest text-muted/70 font-mono">{d.fabricante}</span>
      </div>
    </button>
  );
}
