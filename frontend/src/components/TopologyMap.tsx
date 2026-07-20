import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  Background, BackgroundVariant, Controls, MiniMap, Connection, Edge, Node,
  addEdge, useEdgesState, useNodesState, NodeChange, Viewport, ReactFlowInstance,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { api, Dispositivo, TopoNode, saudeDispositivo } from '../api';
import { TopologyDeviceNode, DeviceNodeData } from './TopologyDeviceNode';
import { TIPOS_EQUIPAMENTO } from './NetIcons';
import { useToast } from './Toast';

// Definido fora do componente pra não recriar a cada render (regra de performance do React Flow)
const nodeTypes = { dispositivo: TopologyDeviceNode };

const COR_EDGE_NEUTRA = 'rgba(233,234,242,0.42)';
const COR_EDGE_OFFLINE = '#FF2B3A';
const COR_EDGE_DEGRADADA = '#FFB224';

// Zoom e posição da câmera ficam salvos por empresa — reabrir a topologia
// devolve exatamente o enquadramento que o operador deixou.
const chaveViewport = (empresaId: number) => `netmonitor_topo_viewport_${empresaId}`;

function viewportSalvo(empresaId: number): Viewport | null {
  try {
    const bruto = localStorage.getItem(chaveViewport(empresaId));
    if (!bruto) return null;
    const vp = JSON.parse(bruto);
    if (typeof vp?.x === 'number' && typeof vp?.y === 'number' && typeof vp?.zoom === 'number') return vp;
    return null;
  } catch {
    return null;
  }
}

export function TopologyMap({
  empresaId,
  dispositivos,
  podeEditar,
  onAbrirDispositivo,
}: {
  empresaId: number;
  dispositivos: Dispositivo[];
  podeEditar: boolean;
  onAbrirDispositivo?: (d: Dispositivo) => void;
}) {
  const [nodes, setNodes, onNodesChangeBase] = useNodesState<DeviceNodeData>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<any>([]);
  const [novoLabel, setNovoLabel] = useState('');
  const [novoTipo, setNovoTipo] = useState('roteador');
  const [novoDispositivoId, setNovoDispositivoId] = useState<string>('');
  const toast = useToast();
  // Lido uma vez no mount: com enquadramento salvo neste navegador, abre direto
  // nele (sem fitView). O banco pode corrigir logo em seguida (vale entre aparelhos).
  const [viewportInicial] = useState<Viewport | null>(() => viewportSalvo(empresaId));
  const instanciaRef = useRef<ReactFlowInstance | null>(null);
  const viewportServidorRef = useRef<Viewport | null>(null);
  const salvarViewportTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const aoMoverCamera = useCallback(
    (_ev: unknown, vp: Viewport) => {
      try {
        localStorage.setItem(chaveViewport(empresaId), JSON.stringify(vp));
      } catch {
        /* armazenamento cheio/indisponível não pode quebrar a topologia */
      }
      // No banco vale pra qualquer aparelho — com debounce pra não martelar a API
      if (!podeEditar) return;
      if (salvarViewportTimer.current) clearTimeout(salvarViewportTimer.current);
      salvarViewportTimer.current = setTimeout(() => {
        api.salvarViewportTopologia(empresaId, vp.x, vp.y, vp.zoom).catch(() => {});
      }, 800);
    },
    [empresaId, podeEditar]
  );

  useEffect(() => {
    return () => {
      if (salvarViewportTimer.current) clearTimeout(salvarViewportTimer.current);
    };
  }, []);

  const carregar = useCallback(async () => {
    const { nodes: dbNodes, edges: dbEdges, viewport } = await api.topologiaEmpresa(empresaId);
    setNodes(
      dbNodes.map((n: TopoNode) => ({
        id: String(n.id),
        type: 'dispositivo',
        position: { x: n.pos_x, y: n.pos_y },
        data: { label: n.label, tipo: n.tipo, dispositivo_id: n.dispositivo_id, status_atual: n.status_atual, ip: n.ip },
      }))
    );
    setEdges(
      dbEdges.map((e) => ({ id: String(e.id), source: String(e.node_origem), target: String(e.node_destino), label: e.label }))
    );
    // O enquadramento salvo no banco é a fonte da verdade entre aparelhos.
    // Pode chegar antes OU depois do canvas montar, então guarda no ref e
    // aplica nos dois momentos (aqui e no onInit).
    if (viewport) {
      const vp: Viewport = { x: Number(viewport.pos_x), y: Number(viewport.pos_y), zoom: Number(viewport.zoom) };
      viewportServidorRef.current = vp;
      instanciaRef.current?.setViewport(vp);
      try {
        localStorage.setItem(chaveViewport(empresaId), JSON.stringify(vp));
      } catch {
        /* sem espaço no storage — segue só com o valor do banco */
      }
    }
  }, [empresaId, setNodes, setEdges]);

  const aoIniciarCanvas = useCallback((instancia: ReactFlowInstance) => {
    instanciaRef.current = instancia;
    if (viewportServidorRef.current) instancia.setViewport(viewportServidorRef.current);
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // Sincroniza status/latência/perda dos nós com a lista viva de dispositivos (socket no pai)
  useEffect(() => {
    setNodes((nds) =>
      nds.map((n) => {
        if (!n.data.dispositivo_id) return n;
        const d = dispositivos.find((dd) => dd.id === n.data.dispositivo_id);
        if (!d) return n;
        if (
          n.data.status_atual === d.status_atual &&
          n.data.latencia_ms === d.latencia_ms &&
          n.data.perda_pct === d.perda_pct
        ) {
          return n;
        }
        return {
          ...n,
          data: { ...n.data, status_atual: d.status_atual, ip: d.ip, latencia_ms: d.latencia_ms, perda_pct: d.perda_pct },
        };
      })
    );
  }, [dispositivos, setNodes]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      onNodesChangeBase(changes);
      if (!podeEditar) return;
      changes.forEach((c) => {
        if (c.type === 'position' && c.position && c.dragging === false) {
          api.moverNode(Number(c.id), c.position.x, c.position.y).catch(() => {
            toast.erro('Posição não foi salva — confira a conexão e arraste de novo.');
          });
        }
      });
    },
    [onNodesChangeBase, podeEditar, toast]
  );

  // Caminho principal de persistência do arranjo: o evento de dragStop SEMPRE
  // traz a posição final (o change de onNodesChange às vezes vem sem ela, o que
  // fazia o layout se perder). Cobre mouse, toque e arraste de seleção múltipla.
  const onNodeDragStop = useCallback(
    (_ev: React.MouseEvent, _node: Node, arrastados: Node[]) => {
      if (!podeEditar) return;
      const lista = arrastados && arrastados.length > 0 ? arrastados : [_node];
      lista.forEach((n) => {
        api.moverNode(Number(n.id), n.position.x, n.position.y).catch(() => {
          toast.erro(`Posição de "${(n.data as DeviceNodeData)?.label ?? n.id}" não foi salva — arraste de novo.`);
        });
      });
    },
    [podeEditar, toast]
  );

  const onConnect = useCallback(
    async (conn: Connection) => {
      if (!podeEditar) return;
      const result: any = await api.criarEdge({
        empresa_id: empresaId,
        node_origem: Number(conn.source),
        node_destino: Number(conn.target),
      });
      setEdges((eds) => addEdge({ ...conn, id: String(result.id) }, eds));
    },
    [empresaId, podeEditar, setEdges]
  );

  // Remoções via Backspace precisam persistir, senão os itens voltam no próximo carregamento
  const onNodesDelete = useCallback(
    (deletados: Node[]) => {
      if (!podeEditar) return;
      deletados.forEach((n) => api.removerNode(Number(n.id)).catch(() => {}));
    },
    [podeEditar]
  );
  const onEdgesDelete = useCallback(
    (deletadas: Edge[]) => {
      if (!podeEditar) return;
      deletadas.forEach((e) => api.removerEdge(Number(e.id)).catch(() => {}));
    },
    [podeEditar]
  );

  const onNodeClick = useCallback(
    (_ev: React.MouseEvent, node: Node<DeviceNodeData>) => {
      if (!node.data.dispositivo_id || !onAbrirDispositivo) return;
      const d = dispositivos.find((dd) => dd.id === node.data.dispositivo_id);
      if (d) onAbrirDispositivo(d);
    },
    [dispositivos, onAbrirDispositivo]
  );

  // Conexões herdam a saúde das pontas: queda pinta a fibra de vermelho,
  // degradação de âmbar, e o tráfego saudável corre em dashes discretos.
  const edgesEstilizadas = useMemo(() => {
    const saudePorNode = new Map<string, string>();
    nodes.forEach((n) => {
      if (!n.data.dispositivo_id) return;
      saudePorNode.set(
        n.id,
        saudeDispositivo({
          status_atual: (n.data.status_atual as any) || 'desconhecido',
          latencia_ms: n.data.latencia_ms ?? null,
          perda_pct: n.data.perda_pct ?? null,
        })
      );
    });

    return edges.map((e) => {
      const a = saudePorNode.get(e.source);
      const b = saudePorNode.get(e.target);
      const temOffline = a === 'offline' || b === 'offline';
      const temDegradado = a === 'degradado' || b === 'degradado';
      return {
        ...e,
        // Ângulos retos + traço mais grosso: leitura de diagrama de rede, não rabisco
        type: 'smoothstep' as const,
        pathOptions: { borderRadius: 10 },
        animated: !temOffline,
        style: temOffline
          ? { stroke: COR_EDGE_OFFLINE, strokeWidth: 2.5, filter: 'drop-shadow(0 0 4px rgba(255,43,58,0.6))' }
          : temDegradado
            ? { stroke: COR_EDGE_DEGRADADA, strokeWidth: 2.2 }
            : { stroke: COR_EDGE_NEUTRA, strokeWidth: 2 },
        labelStyle: { fill: '#A8A8B3', fontSize: 11, fontFamily: '"IBM Plex Mono", monospace' },
        labelBgStyle: { fill: '#0B0B0F', fillOpacity: 0.9 },
      };
    });
  }, [edges, nodes]);

  const dispositivosSemNode = useMemo(() => {
    const idsUsados = new Set(nodes.map((n) => n.data.dispositivo_id).filter(Boolean));
    return dispositivos.filter((d) => !idsUsados.has(d.id));
  }, [nodes, dispositivos]);

  async function adicionarNode() {
    if (!novoLabel.trim()) return;
    const dispositivoId = novoDispositivoId ? Number(novoDispositivoId) : null;
    const pos = { x: 80 + Math.random() * 320, y: 80 + Math.random() * 220 };
    const result: any = await api.criarNode({
      empresa_id: empresaId,
      dispositivo_id: dispositivoId,
      label: novoLabel,
      tipo: novoTipo,
      pos_x: pos.x,
      pos_y: pos.y,
    });
    const d = dispositivoId ? dispositivos.find((x) => x.id === dispositivoId) : undefined;
    setNodes((nds) => [
      ...nds,
      {
        id: String(result.id),
        type: 'dispositivo',
        position: pos,
        data: {
          label: novoLabel,
          tipo: novoTipo,
          dispositivo_id: dispositivoId,
          status_atual: d?.status_atual,
          ip: d?.ip,
          latencia_ms: d?.latencia_ms,
          perda_pct: d?.perda_pct,
        },
      },
    ]);
    setNovoLabel('');
    setNovoDispositivoId('');
  }

  return (
    <div className="flex flex-col h-full gap-3">
      {podeEditar && (
        <div className="glass-panel p-3 flex flex-wrap items-end gap-3 animate-fade-up">
          <div>
            <label className="label-field">Nome do nó</label>
            <input
              value={novoLabel}
              onChange={(e) => setNovoLabel(e.target.value)}
              placeholder="ex: Roteador Borda"
              className="input w-48"
              maxLength={150}
              onKeyDown={(e) => e.key === 'Enter' && adicionarNode()}
            />
          </div>
          <div>
            <label className="label-field">Tipo de equipamento</label>
            <select value={novoTipo} onChange={(e) => setNovoTipo(e.target.value)} className="input w-44">
              {TIPOS_EQUIPAMENTO.map((t) => (
                <option key={t.valor} value={t.valor}>{t.rotulo}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label-field">Vincular dispositivo (opcional)</label>
            <select value={novoDispositivoId} onChange={(e) => setNovoDispositivoId(e.target.value)} className="input w-56">
              <option value="">— nenhum —</option>
              {dispositivosSemNode.map((d) => (
                <option key={d.id} value={d.id}>{d.nome} ({d.ip})</option>
              ))}
            </select>
          </div>
          <button onClick={adicionarNode} className="btn-primary">
            + Adicionar ao mapa
          </button>
          <p className="text-[10px] font-mono text-muted ml-auto self-center hidden lg:block">
            arraste pra posicionar · conecte pelas bordas · backspace remove
          </p>
        </div>
      )}

      <div className="glass-panel flex-1 min-h-[500px] overflow-hidden">
        <ReactFlow
          nodes={nodes}
          edges={edgesEstilizadas}
          onNodesChange={onNodesChange}
          onNodeDragStop={onNodeDragStop}
          onEdgesChange={onEdgesChange}
          onNodesDelete={onNodesDelete}
          onEdgesDelete={onEdgesDelete}
          onConnect={onConnect}
          onNodeClick={onNodeClick}
          nodeTypes={nodeTypes}
          nodesDraggable={podeEditar}
          nodesConnectable={podeEditar}
          deleteKeyCode={podeEditar ? 'Backspace' : null}
          {...(viewportInicial
            ? { defaultViewport: viewportInicial }
            : { fitView: true, fitViewOptions: { padding: 0.3, maxZoom: 1 } })}
          onInit={aoIniciarCanvas}
          onMoveEnd={aoMoverCamera}
          minZoom={0.2}
          maxZoom={2.5}
          onlyRenderVisibleElements
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1.3} color="#26262F" />
          <Controls showInteractive={false} />
          <MiniMap
            pannable
            zoomable
            maskColor="rgba(6,6,7,0.75)"
            nodeColor={(n) =>
              !n.data?.dispositivo_id
                ? '#3A3A46'
                : n.data.status_atual === 'online'
                  ? '#2FD771'
                  : n.data.status_atual === 'offline'
                    ? '#FF2B3A'
                    : '#55555F'
            }
          />
        </ReactFlow>
      </div>
    </div>
  );
}
