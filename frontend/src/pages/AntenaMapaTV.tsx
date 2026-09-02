import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, { Background, BackgroundVariant, ConnectionMode, Controls, Edge, Node, useEdgesState, useNodesState } from 'reactflow';
import 'reactflow/dist/style.css';
import { AntenaEdge as EdgeType, AntenaNode as NodeType, AntenaWireless, antenasApi, socket } from '../apiAntenas';
import { AntenaNode } from '../components/AntenaNode';
import { AntenaEdge } from '../components/AntenaEdge';
import { LogoUptimeXNav } from '../components/LogoUptimeX';

const INTERVALO_ATUALIZACAO_MS = 20000;

const nodeTypes = { antena: AntenaNode };
const edgeTypes = { antena: AntenaEdge };

function Placar({ valor, rotulo, tom }: { valor: number | string; rotulo: string; tom?: 'online' | 'offline' | 'warn' | 'muted' }) {
  const cor =
    tom === 'offline' ? 'text-offline' : tom === 'online' ? 'text-online' : tom === 'warn' ? 'text-warn' : tom === 'muted' ? 'text-muted' : 'text-slate-100';
  return (
    <div className="flex flex-col items-center px-4 sm:px-5">
      <span className={`stat-number leading-none tabular-nums text-3xl sm:text-4xl ${cor}`}>{valor}</span>
      <span className="text-[10px] sm:text-[11px] uppercase tracking-[0.2em] text-muted font-mono mt-1">{rotulo}</span>
    </div>
  );
}

/**
 * Board somente-leitura pra deixar aberto numa TV/parede do NOC: mesma topologia
 * do editor (ícones, cores e curvas customizados), sem nenhuma ação de edição.
 */
export function AntenaMapaTV({ onSair }: { onSair: () => void }) {
  const [antenas, setAntenas] = useState<AntenaWireless[]>([]);
  const [nodes, setNodes, onNodesChange] = useNodesState([] as Node[]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([] as Edge[]);
  const [agora, setAgora] = useState(new Date());
  const [emTelaCheia, setEmTelaCheia] = useState(false);
  const [ocultarLabels, setOcultarLabels] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const antenaPorNodeRef = useRef<Map<string, number | null>>(new Map());

  const carregar = useCallback(async () => {
    try {
      // A TV mostra o preset ATIVO (congelado); sem preset ativo, cai no board ao vivo.
      const [lista, topo] = await Promise.all([antenasApi.listarAntenas(), antenasApi.obterTopologiaTV()]);
      setAntenas(lista);

      const flowNodes: Node[] = topo.nodes.map((n: NodeType) => ({
        id: String(n.id),
        type: 'antena',
        position: { x: Number(n.pos_x) || 0, y: Number(n.pos_y) || 0 },
        draggable: false,
        connectable: false,
        selectable: false,
        data: { ...n },
      }));

      const flowEdges: Edge[] = topo.edges.map((e: EdgeType) => ({
        id: String(e.id),
        source: String(e.origem_node_id),
        target: String(e.destino_node_id),
        sourceHandle: e.origem_lado && e.origem_lado !== 'auto' ? e.origem_lado : undefined,
        targetHandle: e.destino_lado && e.destino_lado !== 'auto' ? e.destino_lado : undefined,
        type: 'antena',
        label: e.label || undefined,
        selectable: false,
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
          origem_lado: e.origem_lado,
          destino_lado: e.destino_lado,
          formato: e.formato,
          mostrar_label: e.mostrar_label,
        },
      }));

      antenaPorNodeRef.current = new Map(flowNodes.map((n) => [n.id, n.data.antena_id ?? null]));
      setNodes(flowNodes);
      setEdges(flowEdges);
      setOcultarLabels(!!topo.viewport?.ocultar_labels);
    } catch {
      /* mantém o último snapshot se uma atualização falhar */
    }
  }, []);

  useEffect(() => {
    carregar();
    const id = setInterval(carregar, INTERVALO_ATUALIZACAO_MS);
    return () => clearInterval(id);
  }, [carregar]);

  useEffect(() => {
    const id = setInterval(() => setAgora(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const aoMudar = () => setEmTelaCheia(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', aoMudar);
    return () => document.removeEventListener('fullscreenchange', aoMudar);
  }, []);

  useEffect(() => {
    const aoReceberHeartbeat = (p: any) =>
      setAntenas((atuais) => atuais.map((a) => (a.id === p.antenaId ? { ...a, status_atual: p.statusNovo || p.status || a.status_atual, latencia_ms: p.latenciaMs, perda_pct: p.perdaPct, ultima_verificacao: p.timestamp } : a)));
    socket.on('antena:heartbeat', aoReceberHeartbeat);
    socket.on('antena:status_mudou', aoReceberHeartbeat);
    return () => {
      socket.off('antena:heartbeat', aoReceberHeartbeat);
      socket.off('antena:status_mudou', aoReceberHeartbeat);
    };
  }, []);

  // Repassa status/latência atualizados por socket pros nós, sem mexer em posição/topologia
  useEffect(() => {
    setNodes((nds) =>
      nds.map((n) => {
        if (!n.data.antena_id) return n;
        const a = antenas.find((aa) => aa.id === n.data.antena_id);
        if (!a || n.data.status_atual === a.status_atual) return n;
        return { ...n, data: { ...n.data, status_atual: a.status_atual, latencia_ms: a.latencia_ms, perda_pct: a.perda_pct, ultima_verificacao: a.ultima_verificacao } };
      })
    );
  }, [antenas]);

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
      const esconder_label = ocultarLabels || e.data?.mostrar_label === false;
      return { ...e, data: { ...e.data, status, esconder_label } };
    });
  }, [edges, antenas, ocultarLabels]);

  const resumo = useMemo(() => {
    let online = 0, offline = 0, degradadas = 0;
    antenas.forEach((a) => {
      if (a.status_atual === 'offline') offline++;
      if (a.status_atual === 'online') {
        online++;
        if ((a.latencia_ms !== null && a.latencia_ms > 100) || (a.perda_pct !== null && a.perda_pct > 2)) degradadas++;
      }
    });
    return { total: antenas.length, online, offline, degradadas, enlaces: edges.length };
  }, [antenas, edges]);

  const estado: 'offline' | 'degradado' | 'online' | 'vazio' =
    antenas.length === 0 ? 'vazio' : resumo.offline > 0 ? 'offline' : resumo.degradadas > 0 ? 'degradado' : 'online';
  const corEstado = estado === 'offline' ? 'text-offline' : estado === 'degradado' ? 'text-warn' : estado === 'vazio' ? 'text-muted' : 'text-online';
  const fraseEstado =
    estado === 'offline' ? `${resumo.offline} ${resumo.offline === 1 ? 'ANTENA OFFLINE' : 'ANTENAS OFFLINE'}` :
    estado === 'degradado' ? `${resumo.degradadas} COM ATENÇÃO` :
    estado === 'vazio' ? 'SEM ANTENAS' : 'TUDO NO AR';

  async function alternarTelaCheia() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await containerRef.current?.requestFullscreen();
    } catch {
      /* alguns navegadores exigem gesto/permitem bloquear — ignora silenciosamente */
    }
  }

  return (
    <div ref={containerRef} className={`fixed inset-0 z-[60] bg-deep-950 flex flex-col ${estado === 'offline' ? 'animate-alert-pulse' : ''}`}>
      <header className="glass-panel rounded-none border-x-0 border-t-0 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 sm:px-8 py-3 sm:py-4 shrink-0">
        <div className="flex items-center gap-5 min-w-0">
          <LogoUptimeXNav />
          <div className="hidden md:block h-9 w-px bg-white/10" />
          <div className="min-w-0">
            <p className="eyebrow">Visualização · Antenas & Topologia</p>
            <p className={`font-display font-semibold text-lg sm:text-2xl leading-none tracking-tight ${corEstado}`}>{fraseEstado}</p>
          </div>
        </div>

        <div className="flex items-center gap-1 sm:gap-2">
          <Placar valor={resumo.total} rotulo="antenas" />
          <div className="h-10 w-px bg-white/10" />
          <Placar valor={resumo.online} rotulo="online" tom="online" />
          <Placar valor={resumo.degradadas} rotulo="degradadas" tom={resumo.degradadas > 0 ? 'warn' : 'muted'} />
          <Placar valor={resumo.offline} rotulo="offline" tom={resumo.offline > 0 ? 'offline' : 'muted'} />
          <div className="h-10 w-px bg-white/10 hidden sm:block" />
          <Placar valor={resumo.enlaces} rotulo="enlaces" />
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right hidden lg:block">
            <p className="stat-number text-2xl leading-none text-slate-100 tabular-nums">
              {agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
            </p>
            <p className="flex items-center justify-end gap-1.5 text-[10px] font-mono uppercase tracking-widest text-muted mt-1">
              <span className="relative flex w-2 h-2">
                <span className="absolute inline-flex h-full w-full rounded-full bg-online/40 animate-sonar" />
                <span className="relative inline-flex rounded-full w-2 h-2 bg-online" />
              </span>
              somente leitura
            </p>
          </div>
          <button onClick={alternarTelaCheia} className="btn-ghost border border-white/10" aria-label={emTelaCheia ? 'Sair da tela cheia' : 'Entrar em tela cheia'}>
            {emTelaCheia ? 'Restaurar' : 'Tela cheia'}
          </button>
          <button onClick={onSair} className="btn-ghost" aria-label="Voltar ao editor de Antenas">
            Sair
          </button>
        </div>
      </header>

      <div className="flex-1 min-h-0 relative bg-deep-950">
        <ReactFlow
          nodes={nodes}
          edges={edgesEstilizadas}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          connectionMode={ConnectionMode.Loose}
          panOnDrag
          zoomOnScroll
          minZoom={0.2}
          maxZoom={2.5}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          proOptions={{ hideAttribution: true }}
          className="bg-deep-950"
        >
          <Background color="rgba(255, 43, 58, 0.04)" gap={24} size={1.5} variant={BackgroundVariant.Dots} />
          <Controls
            showInteractive={false}
            className="!bg-deep-900/90 !border-white/10 !rounded-xl !shadow-glass [&>button]:!bg-transparent [&>button]:!border-white/5 [&>button]:!text-slate-300 [&>button:hover]:!bg-white/10"
          />
        </ReactFlow>
      </div>
    </div>
  );
}
