import { memo, useCallback } from 'react';
import {
  EdgeProps,
  EdgeLabelRenderer,
  Position,
  getBezierPath,
  getSmoothStepPath,
  useStore,
  type ReactFlowState,
} from 'reactflow';
import { EstiloEnlace, FormatoEnlace, LadoEnlace, TipoEnlace } from '../apiAntenas';

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
  origem_lado?: LadoEnlace | null;
  destino_lado?: LadoEnlace | null;
  formato?: FormatoEnlace | null;
  // Efetivo (global OU por-edge): quando true, esconde o rótulo, deixando só o traço.
  esconder_label?: boolean;
  onDelete?: (id: string) => void;
  onEditar?: (id: string) => void;
}

// --- Anchor flutuante (modo "auto") ----------------------------------------
// Quando o lado da ponta é 'auto'/nulo, calculamos o ponto de saída na borda do
// nó voltada para o outro nó (estilo The Dude / floating edges), em vez de fixar
// um handle. Lados explícitos (topo/base/esq/dir) já vêm resolvidos pelo React
// Flow via sourceHandle/targetHandle e usamos as coords que ele passa.
interface RetanguloNo {
  cx: number;
  cy: number;
  w: number;
  h: number;
}

function retanguloNo(node: any): RetanguloNo | null {
  if (!node) return null;
  const x = node.positionAbsolute?.x ?? node.position?.x ?? 0;
  const y = node.positionAbsolute?.y ?? node.position?.y ?? 0;
  const w = node.width ?? 0;
  const h = node.height ?? 0;
  if (!w || !h) return null; // ainda não medido — cai no fallback dos props
  return { cx: x + w / 2, cy: y + h / 2, w, h };
}

function anchorFlutuante(reto: RetanguloNo, alvo: RetanguloNo): { x: number; y: number; position: Position } {
  const dx = alvo.cx - reto.cx;
  const dy = alvo.cy - reto.cy;
  if (dx === 0 && dy === 0) {
    return { x: reto.cx, y: reto.cy - reto.h / 2, position: Position.Top };
  }
  const w2 = reto.w / 2;
  const h2 = reto.h / 2;
  const escalaX = dx !== 0 ? w2 / Math.abs(dx) : Infinity;
  const escalaY = dy !== 0 ? h2 / Math.abs(dy) : Infinity;
  const escala = Math.min(escalaX, escalaY);
  const x = reto.cx + dx * escala;
  const y = reto.cy + dy * escala;
  const position =
    escalaX < escalaY ? (dx > 0 ? Position.Right : Position.Left) : dy > 0 ? Position.Bottom : Position.Top;
  return { x, y, position };
}

// --- Traçado "raio" (zigue-zague wireless, referência The Dude) --------------
// Constantes fáceis de ajustar quando chegar o print de referência exato.
const RAIO_AMPLITUDE = 7; // deslocamento perpendicular de cada dente (px)
const RAIO_SEG_PX = 20; // comprimento aproximado de cada dente ao longo da linha

function caminhoRaio(
  x1: number,
  y1: number,
  x2: number,
  y2: number
): { path: string; labelX: number; labelY: number } {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.hypot(dx, dy) || 1;
  const px = -dy / dist; // perpendicular unitário
  const py = dx / dist;
  let n = Math.max(4, Math.round(dist / RAIO_SEG_PX));
  if (n % 2 !== 0) n += 1; // par: sai e chega alinhado ao eixo da linha
  let d = `M ${x1} ${y1}`;
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const bx = x1 + dx * t;
    const by = y1 + dy * t;
    const lado = i % 2 === 1 ? 1 : -1;
    d += ` L ${bx + px * RAIO_AMPLITUDE * lado} ${by + py * RAIO_AMPLITUDE * lado}`;
  }
  d += ` L ${x2} ${y2}`;
  return { path: d, labelX: (x1 + x2) / 2, labelY: (y1 + y2) / 2 };
}

export const AntenaEdge = memo(function AntenaEdge({
  id,
  source,
  target,
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
  const origemAuto = !data?.origem_lado || data.origem_lado === 'auto';
  const destinoAuto = !data?.destino_lado || data.destino_lado === 'auto';

  // Só precisamos das dimensões dos nós quando alguma ponta é automática.
  const precisaGeometria = origemAuto || destinoAuto;
  const seletor = useCallback(
    (s: ReactFlowState) =>
      precisaGeometria
        ? { origem: s.nodeInternals.get(source), destino: s.nodeInternals.get(target) }
        : { origem: undefined, destino: undefined },
    [precisaGeometria, source, target]
  );
  const { origem: noOrigem, destino: noDestino } = useStore(
    seletor,
    (a, b) => a.origem === b.origem && a.destino === b.destino
  );
  const rectOrigem = retanguloNo(noOrigem);
  const rectDestino = retanguloNo(noDestino);

  let sx = sourceX;
  let sy = sourceY;
  let posOrigem = sourcePosition;
  let tx = targetX;
  let ty = targetY;
  let posDestino = targetPosition;

  if (origemAuto && rectOrigem && rectDestino) {
    const a = anchorFlutuante(rectOrigem, rectDestino);
    sx = a.x;
    sy = a.y;
    posOrigem = a.position;
  }
  if (destinoAuto && rectOrigem && rectDestino) {
    const a = anchorFlutuante(rectDestino, rectOrigem);
    tx = a.x;
    ty = a.y;
    posDestino = a.position;
  }

  const formato: FormatoEnlace = data?.formato || (data?.curvo ? 'curva' : 'reta');

  let edgePath: string;
  let labelX: number;
  let labelY: number;
  if (formato === 'raio') {
    const r = caminhoRaio(sx, sy, tx, ty);
    edgePath = r.path;
    labelX = r.labelX;
    labelY = r.labelY;
  } else if (formato === 'curva') {
    [edgePath, labelX, labelY] = getBezierPath({
      sourceX: sx,
      sourceY: sy,
      sourcePosition: posOrigem,
      targetX: tx,
      targetY: ty,
      targetPosition: posDestino,
    });
  } else {
    [edgePath, labelX, labelY] = getSmoothStepPath({
      sourceX: sx,
      sourceY: sy,
      sourcePosition: posOrigem,
      targetX: tx,
      targetY: ty,
      targetPosition: posDestino,
      borderRadius: 10,
    });
  }

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

  const esconderLabel = !!data?.esconder_label;

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

      {/* Rótulo central estilizado — some quando ocultado, mas as ações continuam
          acessíveis ao selecionar a linha (pra reativar o rótulo). */}
      {(!esconderLabel || selected) && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
            }}
            className="group/edge flex items-center gap-1.5"
          >
            {!esconderLabel && (
              <div
                className={`px-2 py-0.5 rounded-full text-[10px] font-mono tracking-tight shadow-lg border transition-all ${
                  selected
                    ? 'bg-deep-800 border-signal-500 text-signal-400 font-bold scale-105'
                    : 'bg-deep-900/90 backdrop-blur-md border-white/15 text-slate-300 hover:border-white/40'
                }`}
              >
                <div className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: corLinha }} />
                  <span>{textoRotulo}</span>
                  {data?.capacidade_mbps && (
                    <span className="text-[9px] text-muted font-normal">({data.capacidade_mbps}M)</span>
                  )}
                </div>
              </div>
            )}

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
      )}
    </>
  );
});
