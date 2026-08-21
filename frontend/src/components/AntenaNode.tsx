import { memo } from 'react';
import { Handle, Position } from 'reactflow';
import { AntenaNode as AntenaNodeType } from '../apiAntenas';
import { iconeAntenaPorTipo } from './AntenaIcons';

export interface AntennaNodeData extends Partial<AntenaNodeType> {
  onPing?: (id: number) => void;
  onOpenDrawer?: (id: number) => void;
}

export const AntenaNode = memo(function AntenaNode({ data }: { data: AntennaNodeData }) {
  const isOnline = data.status_atual === 'online';
  const isOffline = data.status_atual === 'offline';
  const isDegradado =
    isOnline &&
    ((data.latencia_ms !== null && data.latencia_ms !== undefined && data.latencia_ms > 100) ||
      (data.perda_pct !== null && data.perda_pct !== undefined && data.perda_pct > 2));
  const Icone = iconeAntenaPorTipo(data.tipo_visual || 'antena_ptp');
  const isTorre = data.tipo_visual === 'torre' || data.tipo_wireless === 'torre';

  let cardStyle = 'border-white/10 hover:border-white/30';
  let iconeStyle = 'text-muted border-white/10 bg-white/[0.03]';
  let dotClass = 'bg-muted';
  let textClass = 'text-muted';
  let statusRotulo = 'AGUARDANDO';

  if (isOffline) {
    cardStyle = 'border-signal-500/70 bg-signal-600/10 animate-alert-pulse';
    iconeStyle = 'text-signal-400 border-signal-500/50 bg-signal-600/15';
    dotClass = 'status-dot-offline animate-alert-blink';
    textClass = 'text-offline';
    statusRotulo = 'OFFLINE';
  } else if (isDegradado) {
    cardStyle = 'border-warn/50 bg-warn/5';
    iconeStyle = 'text-warn border-warn/40 bg-warn/10';
    dotClass = 'status-dot-warn animate-warn-pulse';
    textClass = 'text-warn';
    statusRotulo = 'DEGRADADO';
  } else if (isOnline) {
    cardStyle = 'border-white/20 hover:border-white/40';
    iconeStyle = 'text-online border-white/15 bg-white/[0.05]';
    dotClass = 'status-dot-online';
    textClass = 'text-online';
    statusRotulo = 'ONLINE';
  }

  return (
    <div
      className={`relative rounded-xl border bg-deep-900 shadow-glass transition-colors duration-300 ${
        isTorre ? 'hud-corners px-4 py-3 min-w-[190px]' : 'px-3.5 py-3 min-w-[170px]'
      } ${cardStyle}`}
    >
      <Handle type="source" position={Position.Top} id="topo" />
      <Handle type="source" position={Position.Left} id="esq" />
      <div className="flex items-center gap-2.5">
        <span className={`flex items-center justify-center shrink-0 rounded-lg border ${isTorre ? 'w-9 h-9' : 'w-8 h-8'} ${iconeStyle}`}>
          <Icone width={isTorre ? 20 : 18} height={isTorre ? 20 : 18} />
        </span>
        <div className="min-w-0 text-left">
          <p className="font-display text-sm font-semibold text-slate-100 leading-tight truncate max-w-[150px]" title={data.label}>
            {data.label}
          </p>
          <span className={`inline-flex items-center gap-1.5 mt-1 text-[10px] font-mono uppercase tracking-wider ${textClass}`}>
            <span className={`inline-flex rounded-full w-1.5 h-1.5 ${dotClass}`} />
            {statusRotulo}
          </span>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} id="base" />
      <Handle type="source" position={Position.Right} id="dir" />
    </div>
  );
});
