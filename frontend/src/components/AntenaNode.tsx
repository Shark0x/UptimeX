import { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { AntenaNode as AntenaNodeType } from '../apiAntenas';
import { iconeAntenaPorTipo } from './AntenaIcons';

export interface AntennaNodeData extends Partial<AntenaNodeType> {
  onPing?: (id: number) => void;
  onOpenDrawer?: (id: number) => void;
}

/**
 * Nó da topologia no estilo "The Dude / EVE-NG": só o ícone do equipamento com o
 * nome logo abaixo — sem card/fundo. A saúde aparece na cor do ícone (neutro quando
 * está tudo bem, âmbar/vermelho no alerta) e num pontinho antes do nome, que também
 * fica vermelho e pisca na queda.
 */
export const AntenaNode = memo(function AntenaNode({ data, selected }: NodeProps<AntennaNodeData>) {
  const isOnline = data.status_atual === 'online';
  const isOffline = data.status_atual === 'offline';
  const isDegradado =
    isOnline &&
    ((data.latencia_ms !== null && data.latencia_ms !== undefined && data.latencia_ms > 100) ||
      (data.perda_pct !== null && data.perda_pct !== undefined && data.perda_pct > 2));
  const Icone = iconeAntenaPorTipo(data.tipo_visual || 'antena_ptp');
  const isTorre = data.tipo_visual === 'torre' || data.tipo_wireless === 'torre';

  // Sem caixa e sem pontinho: online fica neutro (calmo). O status só "grita" quando
  // há problema — o ícone e o nome viram âmbar (degradado) ou vermelho piscando (queda).
  let iconeClass = 'text-slate-500'; // aguardando (sem monitor)
  let nomeClass = 'text-slate-200';
  let alertaClass = '';

  if (isOffline) {
    iconeClass = 'text-offline';
    nomeClass = 'text-offline';
    alertaClass = 'animate-alert-blink';
  } else if (isDegradado) {
    iconeClass = 'text-warn';
    nomeClass = 'text-slate-100';
  } else if (isOnline) {
    iconeClass = 'text-slate-100';
    nomeClass = 'text-slate-100';
  }

  const tam = isTorre ? 46 : 40;

  return (
    // A caixa do nó é do tamanho do ÍCONE — o nome fica absoluto embaixo pra não
    // aumentar a caixa, senão os enlaces (que saem da borda) grudariam no texto.
    <div className="relative flex items-center justify-center" style={{ width: tam, height: tam }}>
      {/* Âncoras dos enlaces nas 4 bordas do ícone (mantém topo/base/esq/dir) */}
      <Handle type="source" position={Position.Top} id="topo" />
      <Handle type="source" position={Position.Left} id="esq" />
      <Handle type="source" position={Position.Bottom} id="base" />
      <Handle type="source" position={Position.Right} id="dir" />

      <span
        className={`flex items-center justify-center transition-transform duration-200 ${iconeClass} ${alertaClass} ${
          selected ? 'scale-110' : ''
        }`}
        style={{
          filter: selected
            ? 'drop-shadow(0 0 6px rgba(47,215,113,0.45))'
            : 'drop-shadow(0 1px 2px rgba(0,0,0,0.6))',
        }}
      >
        <Icone width={tam} height={tam} />
      </span>

      {/* Nome embaixo do objeto (fora do fluxo, não mexe na medição do nó) */}
      <div
        className="absolute left-1/2 top-full -translate-x-1/2 mt-1.5 pointer-events-none"
        style={{ whiteSpace: 'nowrap' }}
      >
        <span
          className={`font-display text-[12px] font-semibold leading-none ${nomeClass}`}
          style={{ textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}
          title={data.label}
        >
          {data.label}
        </span>
      </div>
    </div>
  );
});
