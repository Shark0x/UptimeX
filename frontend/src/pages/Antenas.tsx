import { useCallback, useEffect, useMemo, useState } from 'react';
import { AntenaEdge, AntenaNode, AntenaWireless, antenasApi, NovaAntenaPayload, socket } from '../apiAntenas';
import { AntenaTopologia } from '../components/AntenaTopologia';
import { AntenaList } from '../components/AntenaList';
import { AntenaLinksView } from '../components/AntenaLinksView';
import { AntenaModal } from '../components/AntenaModal';
import { AntenaLinkModal, EnlacePayload } from '../components/AntenaLinkModal';
import { AntenaDrawer } from '../components/AntenaDrawer';
import { AntenaPresets } from '../components/AntenaPresets';
import { useToast } from '../components/Toast';

type SubAba = 'topologia' | 'lista' | 'enlaces';

const SUB_ABAS: { id: SubAba; label: (n: { antenas: number; edges: number }) => string }[] = [
  { id: 'topologia', label: () => 'Editor de Topologia' },
  { id: 'lista', label: (n) => `Inventário (${n.antenas})` },
  { id: 'enlaces', label: (n) => `Matriz de Enlaces (${n.edges})` },
];

function Kpi({ rotulo, valor, tom }: { rotulo: string; valor: string | number; tom?: 'offline' | 'warn' | 'online' }) {
  const cor = tom === 'offline' ? 'text-offline' : tom === 'warn' ? 'text-warn' : tom === 'online' ? 'text-online' : 'text-slate-100';
  return <div className="flex items-baseline gap-2"><span className={`stat-number text-lg font-mono font-bold ${cor}`}>{valor}</span><span className="text-[10px] uppercase tracking-widest text-muted font-mono">{rotulo}</span></div>;
}

export function Antenas({ onAbrirVisualizacaoTV }: { onAbrirVisualizacaoTV?: () => void }) {
  const [subAba, setSubAba] = useState<SubAba>('topologia');
  const [antenas, setAntenas] = useState<AntenaWireless[]>([]);
  const [nodes, setNodes] = useState<AntenaNode[]>([]);
  const [edges, setEdges] = useState<AntenaEdge[]>([]);
  const [modalAntenaAberto, setModalAntenaAberto] = useState(false);
  const [modalLinkAberto, setModalLinkAberto] = useState(false);
  const [antenaEditando, setAntenaEditando] = useState<AntenaWireless | null>(null);
  const [enlaceEditando, setEnlaceEditando] = useState<AntenaEdge | null>(null);
  const [drawerAntenaId, setDrawerAntenaId] = useState<number | null>(null);
  const [linkOrigemId, setLinkOrigemId] = useState<number | null>(null);
  const [linkDestinoId, setLinkDestinoId] = useState<number | null>(null);
  const [topologiaVersao, setTopologiaVersao] = useState(0);
  const toast = useToast();

  const recarregar = useCallback(async () => {
    try {
      const [lista, topo] = await Promise.all([antenasApi.listarAntenas(), antenasApi.obterTopologia()]);
      setAntenas(lista);
      setNodes(topo.nodes);
      setEdges(topo.edges);
      setTopologiaVersao((v) => v + 1);
    } catch {
      // Backend pode ainda estar reiniciando durante o desenvolvimento.
    }
  }, []);

  useEffect(() => {
    recarregar();
    const aoReceberHeartbeat = (p: any) => setAntenas((atuais) => atuais.map((a) => a.id === p.antenaId ? { ...a, status_atual: p.statusNovo || p.status || a.status_atual, latencia_ms: p.latenciaMs, perda_pct: p.perdaPct, ultima_verificacao: p.timestamp } : a));
    socket.on('antena:heartbeat', aoReceberHeartbeat);
    socket.on('antena:status_mudou', aoReceberHeartbeat);
    return () => {
      socket.off('antena:heartbeat', aoReceberHeartbeat);
      socket.off('antena:status_mudou', aoReceberHeartbeat);
    };
  }, [recarregar]);

  const resumo = useMemo(() => {
    let online = 0, offline = 0, degradadas = 0, somaLat = 0, comLat = 0;
    antenas.forEach((a) => {
      if (a.status_atual === 'offline') offline++;
      if (a.status_atual === 'online') {
        online++;
        if ((a.latencia_ms !== null && a.latencia_ms > 100) || (a.perda_pct !== null && a.perda_pct > 2)) degradadas++;
        if (a.latencia_ms !== null) { somaLat += a.latencia_ms; comLat++; }
      }
    });
    return { total: antenas.length, online, offline, degradadas, latMedia: comLat ? Math.round(somaLat / comLat) : null, enlaces: edges.length };
  }, [antenas, edges]);

  const antenaDrawer = drawerAntenaId === null ? null : antenas.find((a) => a.id === drawerAntenaId) ?? null;
  const iconeAntenaEditando = antenaEditando ? nodes.find((n) => n.antena_id === antenaEditando.id)?.tipo_visual : undefined;

  async function handleSalvarAntena(payload: NovaAntenaPayload) {
    if (antenaEditando) await antenasApi.editarAntena(antenaEditando.id, payload);
    else await antenasApi.criarAntena(payload);
    await recarregar();
  }

  async function handleRemoverAntena(id: number) {
    try {
      await antenasApi.removerAntena(id);
      toast.sucesso('Antena removida');
      setDrawerAntenaId(null);
      await recarregar();
    } catch (err: any) { toast.erro(err.message || 'Erro ao remover antena'); }
  }

  async function handleCriarEnlace(payload: EnlacePayload) {
    await antenasApi.criarEdge(payload);
    await recarregar();
  }

  async function handleEditarEnlace(id: number, payload: Partial<EnlacePayload>) {
    await antenasApi.editarEdge(id, payload);
    await recarregar();
  }

  async function handlePingInstantaneo(id: number) {
    const res = await antenasApi.pingInstantaneo(id);
    if (res.alcancavel) toast.sucesso(`Ping OK: ${res.latenciaMs ? `${Math.round(res.latenciaMs)}ms` : 'Respondendo'}`);
    else toast.erro('Antena não respondeu ao ping (Offline)');
  }

  const abrirNovaAntena = () => { setAntenaEditando(null); setModalAntenaAberto(true); };
  const abrirNovoEnlace = (origem?: number, destino?: number) => {
    setEnlaceEditando(null);
    setLinkOrigemId(origem || null);
    setLinkDestinoId(destino || null);
    setModalLinkAberto(true);
  };
  const abrirEditarEnlace = (edge: AntenaEdge) => {
    setEnlaceEditando(edge);
    setModalLinkAberto(true);
  };

  return (
    <div className="flex flex-col h-full space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-4 glass-panel p-4 border-signal-500/30 hud-corners">
        <div className="flex items-center gap-3.5 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-signal-600/20 border border-signal-500/40 flex items-center justify-center text-signal-400"><svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M4.9 16.1C1 12.2 1 5.8 4.9 1.9" /><path d="M7.8 4.7a6.14 6.14 0 0 0-.8 7.5" /><circle cx="12" cy="9" r="2" /><path d="M16.2 4.8c2 2 2.26 5.11 .8 7.47" /><path d="M19.1 1.9c3.9 3.9 3.9 10.3 0 14.2" /><path d="M9.5 18h5" /><path d="m8 22 4-11 4 11" /></svg></div>
          <div className="min-w-0">
            <h1 className="font-display text-xl font-bold text-slate-100">Painel de Criação — Antenas & Topologia</h1>
            <p className="text-xs font-mono text-muted">Editor de infraestrutura wireless: equipamentos, enlaces e customização visual do mapa</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 rounded-lg border border-online/20 bg-online/5 px-3 py-2 text-[10px] font-mono uppercase tracking-wider text-online"><span className="w-2 h-2 rounded-full bg-online animate-pulse" />Monitoramento ao vivo</div>
          {onAbrirVisualizacaoTV && (
            <button onClick={onAbrirVisualizacaoTV} className="btn-ghost text-xs !py-2 !px-3.5 flex items-center gap-1.5 border border-signal-500/30 text-signal-400 hover:bg-signal-600/10">
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><rect x="2" y="4" width="20" height="14" rx="2" /><path d="M8 21h8M12 18v3" /></svg>
              Abrir Visualização TV
            </button>
          )}
        </div>
      </header>

      {/* z-30: a glass-panel cria contexto de empilhamento (backdrop-filter). Sem um
          z-index explícito, o canvas das antenas (irmão posterior no DOM) pinta por
          cima do dropdown de Presets. Isto sobe a toolbar inteira acima do board. */}
      <div className="glass-panel p-4 flex items-center gap-5 flex-wrap relative z-30">
        <Kpi rotulo="Total Antenas" valor={resumo.total} /><Kpi rotulo="Online" valor={resumo.online} tom="online" /><Kpi rotulo="Offline" valor={resumo.offline} tom={resumo.offline > 0 ? 'offline' : undefined} /><Kpi rotulo="Degradadas" valor={resumo.degradadas} tom={resumo.degradadas > 0 ? 'warn' : undefined} /><Kpi rotulo="Latência Média" valor={resumo.latMedia !== null ? `${resumo.latMedia}ms` : '—'} /><Kpi rotulo="Enlaces PTP" valor={resumo.enlaces} />
        <div className="flex items-center gap-2 ml-auto">
          <AntenaPresets onAplicado={recarregar} />
          <button onClick={abrirNovaAntena} className="btn-primary text-xs !py-2 !px-3.5 shadow-glow-signal">+ Nova Antena</button>
        </div>
      </div>

      <div className="glass-panel p-1.5 inline-flex gap-1 self-start">
        {SUB_ABAS.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setSubAba(id)}
            className={`px-4 py-2 rounded-lg text-sm font-display transition-all whitespace-nowrap ${subAba === id ? 'bg-signal-600/20 text-signal-400 font-bold' : 'text-muted hover:text-slate-200 hover:bg-white/5'}`}
          >
            {label({ antenas: antenas.length, edges: edges.length })}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0">
        {subAba === 'topologia' && (
          <div className="w-full h-full min-h-[560px]">
            <AntenaTopologia
              antenas={antenas}
              onAbrirAntena={(a) => setDrawerAntenaId(a.id)}
              onNovaAntena={abrirNovaAntena}
              onNovoEnlace={abrirNovoEnlace}
              onEditarAntena={(a) => { setAntenaEditando(a); setModalAntenaAberto(true); }}
              onEditarEnlace={abrirEditarEnlace}
              recarregarSinal={topologiaVersao}
            />
          </div>
        )}
        {subAba === 'lista' && <AntenaList antenas={antenas} onAbrirAntena={(a) => setDrawerAntenaId(a.id)} onEditarAntena={(a) => { setAntenaEditando(a); setModalAntenaAberto(true); }} onRemoverAntena={handleRemoverAntena} onPingInstantaneo={handlePingInstantaneo} />}
        {subAba === 'enlaces' && <AntenaLinksView nodes={nodes} edges={edges} onNovoEnlace={() => abrirNovoEnlace()} onEditarEnlace={abrirEditarEnlace} onRecarregar={recarregar} />}
      </div>

      <AntenaModal aberto={modalAntenaAberto} onClose={() => { setModalAntenaAberto(false); setAntenaEditando(null); }} onSalvar={handleSalvarAntena} antenaEditando={antenaEditando} iconeAtual={iconeAntenaEditando} />
      <AntenaLinkModal
        aberto={modalLinkAberto}
        onClose={() => { setModalLinkAberto(false); setEnlaceEditando(null); }}
        nodes={nodes}
        onCriarEnlace={handleCriarEnlace}
        onEditarEnlace={handleEditarEnlace}
        origemPreDefinida={linkOrigemId}
        destinoPreDefinido={linkDestinoId}
        enlaceEditando={enlaceEditando}
      />
      {antenaDrawer && <AntenaDrawer antena={antenaDrawer} onClose={() => setDrawerAntenaId(null)} onEditar={(a) => { setAntenaEditando(a); setModalAntenaAberto(true); }} onRemover={handleRemoverAntena} />}
    </div>
  );
}
