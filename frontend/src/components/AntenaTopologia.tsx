import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Connection,
  ConnectionMode,
  Edge,
  Node,
  useEdgesState,
  useNodesState,
  NodeChange,
  Viewport,
  ReactFlowInstance,
} from 'reactflow';
import 'reactflow/dist/style.css';
import {
  AntenaWireless,
  AntenaEdge as EdgeType,
  AntenaNode as NodeType,
  antenasApi,
} from '../apiAntenas';
import { AntenaNode } from './AntenaNode';
import { AntenaEdge } from './AntenaEdge';
import { AntenaNodeModal } from './AntenaNodeModal';
import { useToast } from './Toast';

const nodeTypes = {
  antena: AntenaNode,
};

const edgeTypes = {
  antena: AntenaEdge,
};

export function AntenaTopologia({
  antenas,
  onAbrirAntena,
  onNovaAntena,
  onNovoEnlace,
  onEditarAntena,
  onEditarEnlace,
  recarregarSinal,
}: {
  antenas: AntenaWireless[];
  onAbrirAntena?: (antena: AntenaWireless) => void;
  onNovaAntena?: () => void;
  onNovoEnlace?: (origemId?: number, destinoId?: number) => void;
  onEditarAntena?: (antena: AntenaWireless) => void;
  onEditarEnlace?: (edge: EdgeType) => void;
  recarregarSinal?: number;
}) {
  const [nodes, setNodes, onNodesChangeBase] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [carregando, setCarregando] = useState(true);
  const [executandoPingGeral, setExecutandoPingGeral] = useState(false);
  const [filtroFabricante, setFiltroFabricante] = useState<string>('todos');
  const [nodeModalAberto, setNodeModalAberto] = useState(false);
  const [nodeEditando, setNodeEditando] = useState<NodeType | null>(null);
  const instanciaRef = useRef<ReactFlowInstance | null>(null);
  const antenaPorNodeRef = useRef<Map<string, number | null>>(new Map());
  const salvarViewportTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cliqueNodeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const primeiraCargaRef = useRef(true);
  const toast = useToast();

  const handlePingInstantaneo = useCallback(
    async (antenaId: number) => {
      try {
        const res = await antenasApi.pingInstantaneo(antenaId);
        if (res.alcancavel) {
          toast.sucesso(`Ping OK: ${res.latenciaMs ? `${Math.round(res.latenciaMs)}ms` : 'Respondendo'}`);
        } else {
          toast.erro('Antena não respondeu ao ping (Offline)');
        }
      } catch (err: any) {
        toast.erro(err.message || 'Erro ao pingar antena');
      }
    },
    [toast]
  );

  const carregar = useCallback(async () => {
    try {
      setCarregando(true);
      const data = await antenasApi.obterTopologia();

      const flowNodes: Node[] = data.nodes.map((n: NodeType) => ({
        id: String(n.id),
        type: 'antena',
        position: { x: Number(n.pos_x) || 0, y: Number(n.pos_y) || 0 },
        data: {
          ...n,
          onPing: (id: number) => handlePingInstantaneo(id),
          onOpenDrawer: (id: number) => {
            const ant = antenas.find((a) => a.id === (n.antena_id || n.id));
            if (ant && onAbrirAntena) onAbrirAntena(ant);
          },
        },
      }));

      const flowEdges: Edge[] = data.edges.map((e: EdgeType) => ({
        id: String(e.id),
        source: String(e.origem_node_id),
        target: String(e.destino_node_id),
        type: 'antena',
        label: e.label || undefined,
        data: {
          tipo_enlace: e.tipo_enlace,
          frequencia: e.frequencia,
          distancia_km: e.distancia_km,
          capacidade_mbps: e.capacidade_mbps,
          cor: e.cor,
          curvo: !!e.curvo,
          espessura: e.espessura,
          estilo: e.estilo,
          animado: e.animado,
        },
      }));

      antenaPorNodeRef.current = new Map(flowNodes.map((n) => [n.id, n.data.antena_id ?? null]));
      setNodes(flowNodes);
      setEdges(flowEdges);

      if (data.viewport && instanciaRef.current) {
        instanciaRef.current.setViewport({
          x: Number(data.viewport.pos_x) || 0,
          y: Number(data.viewport.pos_y) || 0,
          zoom: Number(data.viewport.zoom) || 1,
        });
      }
    } catch (err: any) {
      toast.erro(err.message || 'Erro ao carregar topologia');
    } finally {
      setCarregando(false);
    }
  }, [antenas, handlePingInstantaneo, onAbrirAntena, setEdges, setNodes, toast]);

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Enlace criado/editado a partir de fora do canvas (matriz de enlaces, modal) —
  // recarrega o board pra refletir sem exigir recarregar manual.
  useEffect(() => {
    if (primeiraCargaRef.current) {
      primeiraCargaRef.current = false;
      return;
    }
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recarregarSinal]);

  // Sincroniza status/latência/perda dos nós em memória com a lista viva de antenas (sem mexer na posição)
  useEffect(() => {
    setNodes((nds) =>
      nds.map((n) => {
        if (!n.data.antena_id) return n;
        const a = antenas.find((aa) => aa.id === n.data.antena_id);
        if (!a) return n;
        if (
          n.data.status_atual === a.status_atual &&
          n.data.latencia_ms === a.latencia_ms &&
          n.data.perda_pct === a.perda_pct &&
          n.data.ultima_verificacao === a.ultima_verificacao
        ) {
          return n;
        }
        return {
          ...n,
          data: {
            ...n.data,
            status_atual: a.status_atual,
            latencia_ms: a.latencia_ms,
            perda_pct: a.perda_pct,
            ultima_verificacao: a.ultima_verificacao,
          },
        };
      })
    );
  }, [antenas, setNodes]);

  const handleExcluirEdge = useCallback(
    async (id: string) => {
      try {
        await antenasApi.removerEdge(Number(id));
        setEdges((eds) => eds.filter((e) => e.id !== id));
        toast.sucesso('Enlace removido');
      } catch (err: any) {
        toast.erro(err.message || 'Erro ao remover enlace');
      }
    },
    [setEdges, toast]
  );

  const handleEditarEdgeClique = useCallback(
    (id: string) => {
      const edgeAtual = edges.find((e) => e.id === id);
      if (!edgeAtual || !onEditarEnlace) return;
      onEditarEnlace({
        id: Number(id),
        origem_node_id: Number(edgeAtual.source),
        destino_node_id: Number(edgeAtual.target),
        tipo_enlace: edgeAtual.data?.tipo_enlace || 'ptp_wireless',
        label: edgeAtual.label != null ? String(edgeAtual.label) : null,
        frequencia: edgeAtual.data?.frequencia ?? null,
        distancia_km: edgeAtual.data?.distancia_km ?? null,
        capacidade_mbps: edgeAtual.data?.capacidade_mbps ?? null,
        cor: edgeAtual.data?.cor ?? null,
        curvo: !!edgeAtual.data?.curvo,
        espessura: edgeAtual.data?.espessura ?? null,
        estilo: edgeAtual.data?.estilo ?? null,
        animado: edgeAtual.data?.animado ?? null,
      });
    },
    [edges, onEditarEnlace]
  );

  // Conexões herdam a saúde das pontas — cor/curva customizadas ficam a cargo do AntenaEdge
  const edgesEstilizadas = useMemo(() => {
    const statusPorNode = new Map<string, string>();
    antenaPorNodeRef.current.forEach((antenaId, nodeId) => {
      if (!antenaId) return;
      const a = antenas.find((aa) => aa.id === antenaId);
      statusPorNode.set(nodeId, a?.status_atual || 'desconhecido');
    });

    return edges.map((e) => {
      const a = statusPorNode.get(e.source);
      const b = statusPorNode.get(e.target);
      const status = a === 'offline' || b === 'offline' ? 'offline' : a === 'degradado' || b === 'degradado' ? 'degradado' : 'online';

      return {
        ...e,
        data: { ...e.data, status, onDelete: handleExcluirEdge, onEditar: handleEditarEdgeClique },
      };
    });
  }, [edges, antenas, handleExcluirEdge, handleEditarEdgeClique]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      onNodesChangeBase(changes);
      changes.forEach((c) => {
        if (c.type === 'position' && c.position && c.dragging === false) {
          antenasApi.moverNode(Number(c.id), c.position.x, c.position.y).catch(() => {
            toast.erro('Posição não foi salva — confira a conexão e arraste de novo.');
          });
        }
      });
    },
    [onNodesChangeBase, toast]
  );

  const onNodeDragStop = useCallback(
    (_ev: React.MouseEvent, _node: Node, arrastados: Node[]) => {
      const lista = arrastados && arrastados.length > 0 ? arrastados : [_node];
      lista.forEach((n) => {
        antenasApi.moverNode(Number(n.id), n.position.x, n.position.y).catch(() => {
          toast.erro(`Posição de "${n.data?.label ?? n.id}" não foi salva.`);
        });
      });
    },
    [toast]
  );

  const onConnect = useCallback(
    (params: Connection) => {
      if (!params.source || !params.target) return;
      // Abre o editor completo (nome/cor/curva) em vez de criar direto com valores padrão.
      onNovoEnlace?.(Number(params.source), Number(params.target));
    },
    [onNovoEnlace]
  );

  const onNodesDelete = useCallback((deletados: Node[]) => {
    deletados.forEach((n) => antenasApi.removerNode(Number(n.id)).catch(() => {}));
  }, []);

  const onEdgesDelete = useCallback((deletadas: Edge[]) => {
    deletadas.forEach((e) => antenasApi.removerEdge(Number(e.id)).catch(() => {}));
  }, []);

  const onNodeClick = useCallback(
    (_ev: React.MouseEvent, node: Node) => {
      // Adia a abertura da telemetria pra não competir com um possível duplo-clique (editar item).
      if (cliqueNodeTimer.current) clearTimeout(cliqueNodeTimer.current);
      cliqueNodeTimer.current = setTimeout(() => {
        if (!node.data.antena_id || !onAbrirAntena) return;
        const ant = antenas.find((a) => a.id === node.data.antena_id);
        if (ant) onAbrirAntena(ant);
      }, 220);
    },
    [antenas, onAbrirAntena]
  );

  const onNodeDoubleClick = useCallback((_ev: React.MouseEvent, node: Node) => {
    if (cliqueNodeTimer.current) {
      clearTimeout(cliqueNodeTimer.current);
      cliqueNodeTimer.current = null;
    }
    setNodeEditando({
      id: Number(node.id),
      antena_id: node.data.antena_id ?? null,
      label: node.data.label,
      tipo_visual: node.data.tipo_visual,
      pos_x: node.position.x,
      pos_y: node.position.y,
    } as NodeType);
    setNodeModalAberto(true);
  }, []);

  async function handleSalvarNode(payload: { label: string; tipo_visual: string }) {
    if (nodeEditando) {
      await antenasApi.editarNode(nodeEditando.id, payload);
    } else {
      await antenasApi.criarNode({
        antena_id: null,
        label: payload.label,
        tipo_visual: payload.tipo_visual,
        pos_x: 300 + Math.round(Math.random() * 120),
        pos_y: 300 + Math.round(Math.random() * 120),
      });
    }
    await carregar();
  }

  const aoMoverCamera = useCallback(
    (_ev: unknown, vp: Viewport) => {
      if (salvarViewportTimer.current) clearTimeout(salvarViewportTimer.current);
      salvarViewportTimer.current = setTimeout(() => {
        antenasApi.salvarViewport(vp.x, vp.y, vp.zoom).catch(() => {});
      }, 800);
    },
    []
  );

  async function handlePingGeral() {
    setExecutandoPingGeral(true);
    try {
      await antenasApi.pingTodos();
      toast.sucesso('Varredura ICMP disparada em todas as antenas!');
    } catch (err: any) {
      toast.erro(err.message || 'Erro ao executar ping geral');
    } finally {
      setExecutandoPingGeral(false);
    }
  }

  function handleAutoOrganizar() {
    let yTorre = 50;
    let yPtp = 220;
    let yCpe = 400;

    let xTorre = 450;
    let xPtp = 150;
    let xCpe = 150;

    setNodes((prev) =>
      prev.map((n) => {
        let novaPos = { x: n.position.x, y: n.position.y };
        const tipo = n.data.tipo_wireless || n.data.tipo_visual;

        if (tipo === 'torre' || tipo === 'switch_torre') {
          novaPos = { x: xTorre, y: yTorre };
          xTorre += 300;
        } else if (tipo === 'ptp_master' || tipo === 'ptmp_ap') {
          novaPos = { x: xPtp, y: yPtp };
          xPtp += 260;
        } else {
          novaPos = { x: xCpe, y: yCpe };
          xCpe += 240;
        }

        antenasApi.moverNode(Number(n.id), novaPos.x, novaPos.y).catch(() => {});
        return { ...n, position: novaPos };
      })
    );
    toast.sucesso('Layout auto-organizado por hierarquia wireless!');
  }

  const nodesExibidos = useMemo(() => {
    if (filtroFabricante === 'todos') return nodes;

    return nodes.map((n) => {
      const hidden = n.data.fabricante !== filtroFabricante;
      return n.hidden === hidden ? n : { ...n, hidden };
    });
  }, [filtroFabricante, nodes]);

  return (
    <div className="relative w-full h-full flex flex-col glass-panel overflow-hidden border-signal-500/20">
      {/* Barra de Ferramentas */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-white/[0.08] bg-deep-900/80 backdrop-blur-md z-10">
        <div className="flex items-center gap-2 flex-wrap">
          {onNovaAntena && (
            <button onClick={onNovaAntena} className="btn-primary text-xs !py-1.5 !px-3 flex items-center gap-1.5 shadow-glow-signal">
              <span>+ Nova Antena</span>
            </button>
          )}

          <button
            onClick={handlePingGeral}
            disabled={executandoPingGeral}
            className="btn-ghost text-xs !py-1.5 !px-3 flex items-center gap-1.5 text-cyan-400 hover:text-cyan-300"
            title="Disparar ping ICMP em todas as antenas cadastradas"
          >
            <svg className={`w-3.5 h-3.5 ${executandoPingGeral ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <circle cx="12" cy="12" r="10" />
              <path d="M12 2a10 10 0 0 1 10 10" />
            </svg>
            <span>{executandoPingGeral ? 'Pingando Todas...' : 'Ping em Todas'}</span>
          </button>

          <button
            onClick={handleAutoOrganizar}
            className="btn-ghost text-xs !py-1.5 !px-2.5 text-slate-300"
            title="Organizar automaticamente por hierarquia de torres e enlaces"
          >
            Auto-Organizar
          </button>

          <button
            onClick={() => { setNodeEditando(null); setNodeModalAberto(true); }}
            className="btn-ghost text-xs !py-1.5 !px-2.5 text-slate-300"
            title="Adicionar marcador visual sem monitoramento (torre, site, caixa)"
          >
            + Nó Decorativo
          </button>
        </div>

        {/* Filtros e Controles de Visualização */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono uppercase text-muted">Filtrar:</span>
          <select
            value={filtroFabricante}
            onChange={(e) => setFiltroFabricante(e.target.value)}
            className="bg-deep-800 border border-white/10 rounded-lg px-2.5 py-1 text-xs font-mono text-slate-200 outline-none"
          >
            <option value="todos">Todos Fabricantes</option>
            <option value="ubiquiti">Ubiquiti</option>
            <option value="mikrotik">MikroTik</option>
            <option value="mimosa">Mimosa</option>
            <option value="intelbras">Intelbras</option>
            <option value="cambium">Cambium</option>
          </select>

          <button
            onClick={() => carregar()}
            className="p-1.5 text-muted hover:text-slate-200 hover:bg-white/10 rounded-lg transition-colors"
            title="Recarregar topologia"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
            </svg>
          </button>
        </div>
      </div>

      {/* Canvas do React Flow */}
      <div className="flex-1 w-full h-full relative bg-deep-950">
          <ReactFlow
            nodes={nodesExibidos}
            edges={edgesEstilizadas}
            onNodesChange={onNodesChange}
            onNodeDragStop={onNodeDragStop}
            onNodesDelete={onNodesDelete}
            onEdgesChange={onEdgesChange}
            onEdgesDelete={onEdgesDelete}
            onNodeClick={onNodeClick}
            onNodeDoubleClick={onNodeDoubleClick}
            onConnect={onConnect}
            connectionMode={ConnectionMode.Loose}
            onMoveEnd={aoMoverCamera}
            onInit={(inst) => {
              instanciaRef.current = inst;
            }}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            minZoom={0.2}
            maxZoom={2.5}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            proOptions={{ hideAttribution: true }}
            className="bg-deep-950"
          >
            <Background color="rgba(255, 43, 58, 0.04)" gap={24} size={1.5} variant={BackgroundVariant.Dots} />
            <Controls
              className="!bg-deep-900/90 !border-white/10 !rounded-xl !shadow-glass [&>button]:!bg-transparent [&>button]:!border-white/5 [&>button]:!text-slate-300 [&>button:hover]:!bg-white/10"
            />
            <MiniMap
              nodeColor={(n) => {
                if (n.data?.status_atual === 'offline') return '#FF2B3A';
                if (n.data?.status_atual === 'online') return '#2FD771';
                return '#82828E';
              }}
              maskColor="rgba(6, 6, 7, 0.85)"
              className="!bg-deep-900 !border-white/10 !rounded-xl shadow-glass !w-40 !h-28"
            />
          </ReactFlow>

        {/* Informação Flutuante no Canvas */}
          <div className="absolute bottom-4 left-4 z-10 glass-panel !bg-deep-900/80 px-3 py-2 text-[11px] font-mono text-muted flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-online animate-sonar" />
              <span className="text-slate-300">Clique para abrir telemetria</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-signal-500" />
              <span className="text-slate-300">Arraste para ligar conexões</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-cyan-400" />
              <span className="text-slate-300">Duplo-clique edita nome/ícone</span>
            </div>
          </div>
      </div>

      <AntenaNodeModal
        aberto={nodeModalAberto}
        onClose={() => setNodeModalAberto(false)}
        onSalvar={handleSalvarNode}
        nodeEditando={nodeEditando}
      />
    </div>
  );
}
