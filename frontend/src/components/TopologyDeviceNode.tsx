import { memo } from 'react';
import { Handle, Position } from 'reactflow';
import { SaudeDispositivo, saudeDispositivo } from '../api';
import { iconePorTipo, rotuloPorTipo } from './NetIcons';

export interface DeviceNodeData {
  label: string;
  tipo: string;
  dispositivo_id: number | null;
  status_atual?: string;
  ip?: string;
  latencia_ms?: number | null;
  perda_pct?: number | null;
}

/** Nós de agrupamento ganham tratamento visual próprio (maiores, cantoneiras HUD) */
const TIPOS_GRUPO = new Set(['pop', 'datacenter', 'backbone', 'internet']);

function estiloPorSaude(saude: SaudeDispositivo | 'sem-monitor') {
  switch (saude) {
    case 'offline':
      return {
        card: 'border-signal-500/70 bg-signal-600/10 animate-alert-pulse',
        icone: 'text-signal-400 border-signal-500/50 bg-signal-600/15',
        dot: 'status-dot-offline animate-alert-blink',
        texto: 'text-offline',
        rotulo: 'OFFLINE',
      };
    case 'degradado':
      return {
        card: 'border-warn/50',
        icone: 'text-warn border-warn/40 bg-warn/10',
        dot: 'status-dot-warn animate-warn-pulse',
        texto: 'text-warn',
        rotulo: 'DEGRADADO',
      };
    case 'online':
      return {
        card: 'border-white/20 hover:border-white/40',
        icone: 'text-online border-white/15 bg-white/[0.05]',
        dot: 'status-dot-online',
        texto: 'text-online',
        rotulo: 'ONLINE',
      };
    case 'sem-monitor':
      return {
        card: 'border-white/[0.14] opacity-90',
        icone: 'text-muted border-white/10 bg-white/[0.03]',
        dot: '',
        texto: 'text-muted',
        rotulo: '',
      };
    default:
      return {
        card: 'border-white/10',
        icone: 'text-muted border-white/10 bg-white/[0.03]',
        dot: 'bg-muted',
        texto: 'text-muted',
        rotulo: 'AGUARDANDO',
      };
  }
}

export const TopologyDeviceNode = memo(function TopologyDeviceNode({ data }: { data: DeviceNodeData }) {
  const monitorado = !!data.dispositivo_id;
  const saude: SaudeDispositivo | 'sem-monitor' = monitorado
    ? saudeDispositivo({
        status_atual: (data.status_atual as any) || 'desconhecido',
        latencia_ms: data.latencia_ms ?? null,
        perda_pct: data.perda_pct ?? null,
      })
    : 'sem-monitor';

  const s = estiloPorSaude(saude);
  const Icone = iconePorTipo(data.tipo);
  const grupo = TIPOS_GRUPO.has(data.tipo);

  return (
    <div
      className={`relative rounded-xl border bg-deep-900
        shadow-glass transition-colors duration-300 ${grupo ? 'hud-corners px-4 py-3 min-w-[170px]' : 'px-3.5 py-3 min-w-[160px]'} ${s.card}`}
    >
      <Handle type="target" position={Position.Top} />
      <Handle type="target" position={Position.Left} id="esq" />

      <div className="flex items-center gap-2.5">
        <span
          className={`flex items-center justify-center shrink-0 rounded-lg border transition-colors duration-300
            ${grupo ? 'w-9 h-9' : 'w-8 h-8'} ${s.icone}`}
        >
          <Icone width={grupo ? 20 : 18} height={grupo ? 20 : 18} />
        </span>
        <div className="min-w-0 text-left">
          <p className="text-[9px] uppercase tracking-[0.18em] text-muted font-mono leading-none mb-0.5">
            {rotuloPorTipo(data.tipo)}
          </p>
          <p className="font-display text-sm font-semibold text-slate-100 leading-tight truncate max-w-[150px]">
            {data.label}
          </p>
          {data.ip && <p className="font-mono text-[11px] text-slate-400 leading-tight mt-0.5">{data.ip}</p>}
        </div>
      </div>

      {monitorado && (
        <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-white/[0.06]">
          <span className="flex items-center gap-1.5">
            <span className="relative flex items-center justify-center w-2 h-2">
              {saude === 'online' && (
                <span className="absolute inline-flex h-full w-full rounded-full bg-online/30 animate-sonar" />
              )}
              <span className={`relative inline-flex rounded-full w-1.5 h-1.5 ${s.dot}`} />
            </span>
            <span className={`text-[10px] font-mono uppercase tracking-wider ${s.texto}`}>{s.rotulo}</span>
          </span>
          {data.latencia_ms !== null && data.latencia_ms !== undefined && saude !== 'offline' && (
            <span className={`text-[10px] font-mono tabular-nums ${saude === 'degradado' ? 'text-warn' : 'text-slate-400'}`}>
              {Math.round(data.latencia_ms)} ms
              {data.perda_pct !== null && data.perda_pct !== undefined && data.perda_pct > 0
                ? ` · ${data.perda_pct.toFixed(0)}%`
                : ''}
            </span>
          )}
        </div>
      )}

      <Handle type="source" position={Position.Bottom} />
      <Handle type="source" position={Position.Right} id="dir" />
    </div>
  );
});
