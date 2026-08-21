import { useState } from 'react';
import {
  AntenaEdge,
  AntenaNode,
  antenasApi,
} from '../apiAntenas';
import { useToast } from './Toast';

export function AntenaLinksView({
  nodes,
  edges,
  onNovoEnlace,
  onEditarEnlace,
  onRecarregar,
}: {
  nodes: AntenaNode[];
  edges: AntenaEdge[];
  onNovoEnlace: () => void;
  onEditarEnlace: (edge: AntenaEdge) => void;
  onRecarregar: () => void;
}) {
  const [removendoId, setRemovendoId] = useState<number | null>(null);
  const toast = useToast();

  const nodeMap = new Map<number, AntenaNode>();
  nodes.forEach((n) => nodeMap.set(n.id, n));

  async function handleRemover(id: number) {
    if (!confirm('Deseja realmente desconectar este enlace?')) return;
    setRemovendoId(id);
    try {
      await antenasApi.removerEdge(id);
      toast.sucesso('Enlace desconectado');
      onRecarregar();
    } catch (err: any) {
      toast.erro(err.message || 'Erro ao remover enlace');
    } finally {
      setRemovendoId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="glass-panel p-4 flex items-center justify-between">
        <div>
          <h3 className="font-display text-sm font-semibold text-slate-100">
            Matriz de Enlaces Wireless & Cabos de Torre
          </h3>
          <p className="text-xs font-mono text-muted">
            Total de {edges.length} conexões cadastradas no mapa
          </p>
        </div>
        <button onClick={onNovoEnlace} className="btn-primary text-xs">
          + Conectar Novo Enlace
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {edges.map((e) => {
          const origem = nodeMap.get(e.origem_node_id);
          const destino = nodeMap.get(e.destino_node_id);

          const origemOnline = origem?.status_atual === 'online';
          const destinoOnline = destino?.status_atual === 'online';
          const linkSaudavel = origemOnline && destinoOnline;

          return (
            <div
              key={e.id}
              className={`glass-panel p-4 flex flex-col justify-between border transition-all ${
                !linkSaudavel
                  ? 'border-signal-500/40 bg-signal-600/5'
                  : 'border-white/10 hover:border-online/50'
              }`}
            >
              {/* Top Header do Enlace */}
              <div className="flex items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-1.5">
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase bg-white/5 border border-white/10 text-slate-300">
                    {e.tipo_enlace.replace('_', ' ')}
                  </span>
                  {e.cor && <span className="w-3 h-3 rounded-full border border-white/20" style={{ backgroundColor: e.cor }} title="Cor customizada" />}
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-mono uppercase bg-white/5 border border-white/10 text-muted">
                    {e.curvo ? 'Curva' : 'Reta'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-1 text-[10px] font-mono font-bold uppercase ${
                      linkSaudavel ? 'text-online' : 'text-offline'
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${linkSaudavel ? 'status-dot-online' : 'status-dot-offline'}`} />
                    {linkSaudavel ? 'ENLACE ATIVO' : 'DEGRADADO / OFF'}
                  </span>
                  <button
                    onClick={() => onEditarEnlace(e)}
                    className="p-1 hover:bg-white/10 text-slate-400 hover:text-slate-200 rounded transition-colors text-xs"
                    title="Editar nome, cor e formato"
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => handleRemover(e.id)}
                    disabled={removendoId === e.id}
                    className="p-1 hover:bg-signal-500/20 text-signal-400 rounded transition-colors text-xs"
                    title="Desconectar enlace"
                  >
                    ✕
                  </button>
                </div>
              </div>

              {/* Fluxo Origem -> Destino */}
              <div className="grid grid-cols-[1fr,auto,1fr] items-center gap-3 py-2 border-y border-white/[0.06]">
                {/* Origem */}
                <div className="min-w-0">
                  <p className="text-[9px] uppercase font-mono text-muted">Origem (Master/AP)</p>
                  <p className="font-display text-sm font-semibold text-slate-100 truncate" title={origem?.label || 'Equipamento'}>
                    {origem?.label || `Nó #${e.origem_node_id}`}
                  </p>
                  <p className="text-[11px] font-mono text-signal-400">{origem?.ip || '—'}</p>
                </div>

                {/* Seta / Linha de Sinal */}
                <div className="flex flex-col items-center justify-center px-2">
                  <span className="text-[10px] font-mono text-cyan-400 font-bold">
                    {e.distancia_km ? `${e.distancia_km} km` : '—'}
                  </span>
                  <div className="flex items-center gap-1 text-slate-400">
                    <span className="h-[1px] w-6 bg-current" />
                    <span className="text-xs">⇄</span>
                    <span className="h-[1px] w-6 bg-current" />
                  </div>
                  <span className="text-[9px] font-mono text-muted">
                    {e.capacidade_mbps ? `${e.capacidade_mbps} Mbps` : ''}
                  </span>
                </div>

                {/* Destino */}
                <div className="min-w-0 text-right">
                  <p className="text-[9px] uppercase font-mono text-muted">Destino (Slave/CPE)</p>
                  <p className="font-display text-sm font-semibold text-slate-100 truncate" title={destino?.label || 'Equipamento'}>
                    {destino?.label || `Nó #${e.destino_node_id}`}
                  </p>
                  <p className="text-[11px] font-mono text-signal-400">{destino?.ip || '—'}</p>
                </div>
              </div>

              {/* Detalhes do Enlace */}
              <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 mt-2">
                <span>{e.frequencia || 'Frequência não especificada'}</span>
                {e.label && <span className="text-slate-300 italic truncate max-w-[180px]">"{e.label}"</span>}
              </div>
            </div>
          );
        })}

        {edges.length === 0 && (
          <div className="col-span-2 glass-panel p-8 text-center text-muted font-mono text-xs">
            Nenhum enlace wireless conectado ainda. Conecte duas antenas na topologia ou clique no botão acima!
          </div>
        )}
      </div>
    </div>
  );
}
