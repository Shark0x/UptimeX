import { memo } from 'react';
import { EdgeProps, getBezierPath, getSmoothStepPath, EdgeLabelRenderer } from 'reactflow';
import { EstiloEnlace, TipoEnlace } from '../apiAntenas';

export interface AntennaEdgeData {
  tipo_enlace?: TipoEnlace;
  frequencia?: string | null;
  distancia_km?: number | null;
  capacidade_mbps?: number | null;
  status?: 'online' | 'offline' | 'degradado';
  cor?: string | null;
  curvo?: boolean;
  espessura?: number | null;
  estilo?: EstiloEnlace | null;
  animado?: boolean | null;
  onDelete?: (id: string) => void;
  onEditar?: (id: string) => void;
}

export const AntenaEdge = memo(function AntenaEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  label,
  selected,
}: EdgeProps<AntennaEdgeData>) {
  const [edgePath, labelX, labelY] = data?.curvo
    ? getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })
    : getSmoothStepPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, borderRadius: 10 });

  const tipo = data?.tipo_enlace || 'ptp_wireless';
  const status = data?.status || 'online';

  let corLinha = '#2FD771'; // Verde padrão
  let strokeDash = '4 4';
  let animada = true;

  if (status === 'offline') {
    corLinha = '#FF2B3A';
    strokeDash = '6 6';
  } else if (status === 'degradado') {
    corLinha = '#FFB224';
    strokeDash = '4 4';
  } else if (data?.cor) {
    // Cor customizada pelo usuário — só vale quando o enlace está saudável;
    // alerta de queda/degradação sempre tem prioridade visual.
    corLinha = data.cor;
    strokeDash = 'none';
    animada = false;
  } else if (tipo === 'fibra_torre') {
    corLinha = '#00E5FF';
    strokeDash = 'none';
    animada = false;
  } else if (tipo === 'cabo_poe') {
    corLinha = '#94A3B8';
    strokeDash = 'none';
    animada = false;
  }

  // Customizações explícitas do usuário sobrepõem o comportamento automático.
  // Estilo do traço (sólida/tracejada/pontilhada):
  if (data?.estilo) {
    strokeDash = data.estilo === 'solida' ? 'none' : data.estilo === 'tracejada' ? '8 6' : '2 5';
  }
  // Espessura da linha (px); senão o padrão fino de sempre.
  const larguraBase = data?.espessura && data.espessura > 0 ? data.espessura : 1.8;
  // Fluxo animado: honra a escolha do usuário; no automático, pulsa se saudável.
  const deveAnimar = data?.animado != null ? data.animado : animada && status !== 'offline';

  const textoRotulo =
    label ||
    (data?.frequencia
      ? `${data.frequencia}${data.distancia_km ? ` · ${data.distancia_km}km` : ''}`
      : tipo === 'cabo_poe'
      ? 'Cabo PoE'
      : tipo === 'fibra_torre'
      ? 'Fibra 10G'
      : 'Enlace Wireless');

  return (
    <>
      {/* Faixa invisível bem mais larga só pra facilitar clicar/selecionar a linha fina */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        className="react-flow__edge-interaction"
      />

      {/* Linha de fundo / brilho (glow) — acompanha a espessura da linha principal */}
      <path
        d={edgePath}
        fill="none"
        stroke={corLinha}
        strokeWidth={(selected ? larguraBase + 0.7 : larguraBase) + 2.2}
        strokeOpacity={0.2}
        className="transition-all duration-300"
      />

      {/* Linha principal com traço e animação de fluxo */}
      <path
        id={id}
        d={edgePath}
        fill="none"
        stroke={corLinha}
        strokeWidth={selected ? larguraBase + 0.7 : larguraBase}
        strokeDasharray={strokeDash}
        className={`${deveAnimar ? 'animate-pulse' : ''} transition-all duration-300`}
      />

      {/* Rótulo central estilizado */}
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: 'all',
          }}
          className="group/edge flex items-center gap-1.5"
        >
          <div
            className={`px-2 py-0.5 rounded-full text-[10px] font-mono tracking-tight shadow-lg border transition-all ${
              selected
                ? 'bg-deep-800 border-signal-500 text-signal-400 font-bold scale-105'
                : 'bg-deep-900/90 backdrop-blur-md border-white/15 text-slate-300 hover:border-white/40'
            }`}
          >
            <div className="flex items-center gap-1">
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: corLinha }}
              />
              <span>{textoRotulo}</span>
              {data?.capacidade_mbps && (
                <span className="text-[9px] text-muted font-normal">
                  ({data.capacidade_mbps}M)
                </span>
              )}
            </div>
          </div>

          {/* Botões de Editar/Excluir ao selecionar a conexão */}
          {selected && data?.onEditar && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                data.onEditar?.(id);
              }}
              title="Editar nome, cor e formato deste enlace"
              className="p-1 bg-deep-800 border border-white/20 hover:border-signal-500/60 text-slate-300 hover:text-signal-400 rounded-full shadow-lg transition-transform hover:scale-110"
            >
              <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
            </button>
          )}
          {selected && data?.onDelete && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                data.onDelete?.(id);
              }}
              title="Remover este enlace"
              className="p-1 bg-signal-600 hover:bg-signal-500 text-[#fff] rounded-full shadow-lg transition-transform hover:scale-110"
            >
              <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
});
