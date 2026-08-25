import { useEffect, useMemo, useRef, useState } from 'react';
import { Empresa, ResumoStatusEmpresa, socket, StatusGlobalPayload } from '../api';
import { MapaEmpresas, StatusMarcador } from '../components/MapaEmpresas';
import { LogoUptimeXNav } from '../components/LogoUptimeX';
import { combinaBusca } from '../lib/busca';
import { atualizarSnapshotEmpresas, empresasEmCache, resumosEmCache } from '../lib/empresasSnapshot';

// Posição do radar de empresas, arrastável pelo operador e lembrada entre sessões.
const RADAR_POS_CHAVE = 'mapatv_radar_pos';
// Altura mínima que o radar sempre mantém (título + busca + algumas linhas), pra
// nunca virar um sliver ao ser arrastado pro fundo ou reancorado numa tela menor.
const RADAR_ALT_MIN = 160;

// Quanto tempo o banner "acabou de cair" fica à mostra no topo
const DURACAO_BANNER_MS = 12000;

// Mesmo ritmo do restante do painel: pinos e números vivos sem refresh manual
const INTERVALO_ATUALIZACAO_MS = 15000;

// Queda "aposenta" o rótulo do nome após esse tempo: o suporte já viu, então o
// balão sai e sobra só o pino vermelho quieto (o painel lateral segue listando).
const TIMEOUT_ROTULO_MIN = 4 * 60;

const ORDEM_STATUS: Record<StatusMarcador, number> = {
  offline: 0,
  degradado: 1,
  sem: 2,
  online: 3,
};

interface ResumoEmpresa {
  total: number;
  online: number;
  offline: number;
  degradados: number;
  links: number;
  offlineDesde: string | null;
}

function indexarResumos(resumoLista: ResumoStatusEmpresa[]) {
  return Object.fromEntries(
    resumoLista.map((r) => [
      r.id,
      {
        total: Number(r.total),
        online: Number(r.online),
        offline: Number(r.offline),
        degradados: Number(r.degradados),
        links: Number(r.links_dedicados),
        offlineDesde: r.offline_desde ?? null,
      },
    ])
  ) as Record<number, ResumoEmpresa>;
}

/** "há 12min" / "há 1h05" desde o início da queda. */
function tempoDesde(iso: string | null, agora: Date): string {
  if (!iso) return '';
  const min = Math.floor((agora.getTime() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min}min`;
  const h = Math.floor(min / 60);
  return `há ${h}h${String(min % 60).padStart(2, '0')}`;
}

function tempoRelativo(ms: number): string {
  const seg = Math.floor(ms / 1000);
  if (seg < 5) return 'agora';
  if (seg < 60) return `${seg}s`;
  return `${Math.floor(seg / 60)}min`;
}

/** Bloco de contagem grande, pensado pra leitura à distância na TV. */
function Placar({
  valor,
  rotulo,
  tom,
}: {
  valor: number;
  rotulo: string;
  tom?: 'online' | 'offline' | 'warn' | 'muted';
}) {
  const cor =
    tom === 'offline'
      ? 'text-offline'
      : tom === 'online'
        ? 'text-online'
        : tom === 'warn'
          ? 'text-warn'
          : tom === 'muted'
            ? 'text-muted'
            : 'text-slate-100';
  return (
    <div className="flex flex-col items-center px-4 sm:px-6">
      <span className={`stat-number leading-none tabular-nums text-4xl sm:text-5xl ${cor}`}>{valor}</span>
      <span className="text-[10px] sm:text-[11px] uppercase tracking-[0.25em] text-muted font-mono mt-1.5">{rotulo}</span>
    </div>
  );
}

function ItemLegenda({ classe, texto }: { classe: string; texto: string }) {
  return (
    <span className="flex items-center gap-2 text-xs font-mono text-muted">
      <span className={`w-2.5 h-2.5 rounded-full ${classe}`} />
      {texto}
    </span>
  );
}

/**
 * Mural de parede pra TV do suporte: mapa em tela cheia com os pinos de status
 * das sedes (verde no ar / âmbar atenção / vermelho queda) e um placar grande.
 * Atualiza sozinho a cada 15s; o botão "Tela cheia" usa a Fullscreen API pra
 * sumir com a barra do navegador.
 */
export function MapaTV({ onSair, onAbrirEmpresa }: { onSair: () => void; onAbrirEmpresa: (empresa: Empresa) => void }) {
  const [empresas, setEmpresas] = useState<Empresa[]>(() => empresasEmCache() ?? []);
  const [resumos, setResumos] = useState<Record<number, ResumoEmpresa>>(() => indexarResumos(resumosEmCache() ?? []));
  const [atualizadoEm, setAtualizadoEm] = useState<number>(Date.now());
  const [agora, setAgora] = useState<Date>(new Date());
  const [emTelaCheia, setEmTelaCheia] = useState(false);
  const [reenquadrar, setReenquadrar] = useState(0);
  const [nomesNoMapa, setNomesNoMapa] = useState(true);
  const [painelEmpresasAberto, setPainelEmpresasAberto] = useState(true);
  // Filtros do mural: só quem está fora do ar / só clientes com bloco /30 dedicado
  const [soOffline, setSoOffline] = useState(false);
  const [soDedicado, setSoDedicado] = useState(false);
  const [somAtivo, setSomAtivo] = useState(false);
  const [alerta, setAlerta] = useState<{ nome: string; dispositivo: string; em: number } | null>(null);
  // Radar arrastável: null = ancorado no canto; senão posição (x,y) na área do mapa
  const [radarPos, setRadarPos] = useState<{ x: number; y: number } | null>(() => {
    try {
      const raw = localStorage.getItem(RADAR_POS_CHAVE);
      if (!raw) return null;
      const p = JSON.parse(raw);
      // Só aceita o formato esperado — localStorage adulterado/antigo cai no canto
      return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? { x: p.x, y: p.y } : null;
    } catch {
      return null;
    }
  });
  const [buscaRadar, setBuscaRadar] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const radarRef = useRef<HTMLDivElement>(null);
  const arrasteRef = useRef<{ dx: number; dy: number } | null>(null);
  // Refs pra usar dentro do listener do socket sem re-registrar a cada render
  const empresasRef = useRef<Empresa[]>([]);
  const somAtivoRef = useRef(false);
  const audioRef = useRef<AudioContext | null>(null);
  const bannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function carregar() {
    try {
      const [lista, resumoLista] = await atualizarSnapshotEmpresas();
      setEmpresas(lista);
      setResumos(indexarResumos(resumoLista));
      setAtualizadoEm(Date.now());
    } catch {
      /* mantém o último snapshot se uma atualização falhar */
    }
  }

  useEffect(() => {
    carregar();
    const id = setInterval(carregar, INTERVALO_ATUALIZACAO_MS);
    return () => clearInterval(id);
  }, []);

  // Relógio e "atualizado há" batendo de segundo em segundo
  useEffect(() => {
    const id = setInterval(() => setAgora(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const aoMudar = () => setEmTelaCheia(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', aoMudar);
    return () => document.removeEventListener('fullscreenchange', aoMudar);
  }, []);

  // Mantém a lista atual acessível ao listener do socket (que roda com [] deps)
  useEffect(() => {
    empresasRef.current = empresas;
  }, [empresas]);

  // Alerta em tempo real: quando QUALQUER IP para de pingar (ou volta), o backend
  // dispara `status_global`. Recarregamos na hora — o pino/pop-up reflete sem
  // esperar o poll de 15s — e, se caiu, tocamos o alarme + mostramos o banner.
  useEffect(() => {
    function aoMudarGlobal(p: StatusGlobalPayload) {
      carregar();
      if (p.statusNovo !== 'offline') return;
      const emp = empresasRef.current.find((e) => e.id === p.empresaId);
      setAlerta({ nome: emp?.nome ?? 'Empresa', dispositivo: p.dispositivo, em: Date.now() });
      if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
      bannerTimerRef.current = setTimeout(() => setAlerta(null), DURACAO_BANNER_MS);
      if (somAtivoRef.current) tocarAlarme();
    }
    socket.on('status_global', aoMudarGlobal);
    return () => {
      socket.off('status_global', aoMudarGlobal);
      if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
    };
  }, []);

  // Bipe curto de alerta via WebAudio (sem depender de arquivo de áudio)
  function tocarAlarme() {
    const ctx = audioRef.current;
    if (!ctx) return;
    const agoraCtx = ctx.currentTime;
    [0, 0.28].forEach((atraso) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, agoraCtx + atraso);
      gain.gain.exponentialRampToValueAtTime(0.18, agoraCtx + atraso + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, agoraCtx + atraso + 0.22);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(agoraCtx + atraso);
      osc.stop(agoraCtx + atraso + 0.24);
    });
  }

  function alternarSom() {
    if (somAtivo) {
      somAtivoRef.current = false;
      setSomAtivo(false);
      return;
    }
    // O navegador só libera áudio a partir de um gesto do usuário (este clique)
    if (!audioRef.current) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (Ctx) audioRef.current = new Ctx();
    }
    audioRef.current?.resume?.();
    somAtivoRef.current = true;
    setSomAtivo(true);
    tocarAlarme(); // confirma que ligou
  }

  async function alternarTelaCheia() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await containerRef.current?.requestFullscreen();
    } catch {
      /* alguns navegadores exigem gesto/permitem bloquear — ignora silenciosamente */
    }
  }

  // Pior estado da empresa manda na cor do pino (igual ao painel principal)
  const statusPorEmpresa = useMemo(() => {
    const mapa: Record<number, StatusMarcador> = {};
    Object.entries(resumos).forEach(([id, r]) => {
      mapa[Number(id)] =
        r.offline > 0 ? 'offline' : r.degradados > 0 ? 'degradado' : r.online > 0 ? 'online' : 'sem';
    });
    return mapa;
  }, [resumos]);

  const veredito = useMemo(() => {
    let comQueda = 0, comAtencao = 0, ok = 0;
    let disp = 0, dispNoAr = 0, dispOffline = 0;
    empresas.forEach((e) => {
      const r = resumos[e.id];
      if (!r) return;
      disp += r.total;
      dispNoAr += r.online + r.degradados;
      dispOffline += r.offline;
      if (r.offline > 0) comQueda++;
      else if (r.degradados > 0) comAtencao++;
      else if (r.online > 0) ok++;
    });
    return { comQueda, comAtencao, ok, disp, dispNoAr, dispOffline };
  }, [empresas, resumos]);

  const estado: 'offline' | 'degradado' | 'online' | 'vazio' =
    empresas.length === 0
      ? 'vazio'
      : veredito.comQueda > 0
        ? 'offline'
        : veredito.comAtencao > 0
          ? 'degradado'
          : 'online';

  const fraseEstado =
    estado === 'offline'
      ? `${veredito.comQueda} ${veredito.comQueda === 1 ? 'EMPRESA FORA DO AR' : 'EMPRESAS FORA DO AR'}`
      : estado === 'degradado'
        ? `${veredito.comAtencao} COM ATENÇÃO`
        : estado === 'vazio'
          ? 'SEM EMPRESAS'
          : 'TUDO NO AR';

  const corEstado =
    estado === 'offline' ? 'text-offline' : estado === 'degradado' ? 'text-warn' : estado === 'vazio' ? 'text-muted' : 'text-online';

  // Filtros do mural aplicados ao mapa E à lista lateral (o placar segue global)
  const empresasVisiveis = useMemo(
    () =>
      empresas.filter(
        (e) =>
          (!soOffline || statusPorEmpresa[e.id] === 'offline') &&
          (!soDedicado || (resumos[e.id]?.links ?? 0) > 0)
      ),
    [empresas, statusPorEmpresa, resumos, soOffline, soDedicado]
  );

  // Radar lateral: problemas sempre sobem. Quando o socket muda um status,
  // carregar() atualiza os resumos e esta ordenação reposiciona a empresa.
  const empresasOrdenadas = useMemo(
    () =>
      empresasVisiveis
        .map((e) => ({
          empresa: e,
          status: statusPorEmpresa[e.id] ?? 'sem',
          online: (resumos[e.id]?.online ?? 0) + (resumos[e.id]?.degradados ?? 0),
          offline: resumos[e.id]?.offline ?? 0,
          total: resumos[e.id]?.total ?? 0,
          desde: resumos[e.id]?.offlineDesde ?? null,
        }))
        .sort((a, b) =>
          ORDEM_STATUS[a.status] - ORDEM_STATUS[b.status] ||
          b.offline - a.offline ||
          a.empresa.nome.localeCompare(b.empresa.nome)
        ),
    [empresasVisiveis, statusPorEmpresa, resumos]
  );

  // Busca dentro do radar: essencial quando são dezenas/centenas de empresas.
  const radarVisivel = useMemo(
    () => (buscaRadar.trim() ? empresasOrdenadas.filter((r) => combinaBusca(r.empresa.nome, buscaRadar)) : empresasOrdenadas),
    [empresasOrdenadas, buscaRadar]
  );

  // Arraste do radar pela barra de título — posições relativas à área do mapa.
  function radarArrastarInicio(e: React.PointerEvent) {
    if ((e.target as HTMLElement).closest('button, input')) return;
    const area = areaRef.current, radar = radarRef.current;
    if (!area || !radar) return;
    const ar = area.getBoundingClientRect();
    const rr = radar.getBoundingClientRect();
    arrasteRef.current = { dx: e.clientX - rr.left, dy: e.clientY - rr.top };
    setRadarPos({ x: rr.left - ar.left, y: rr.top - ar.top });
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  }
  function radarArrastar(e: React.PointerEvent) {
    const a = arrasteRef.current;
    if (!a) return;
    const area = areaRef.current, radar = radarRef.current;
    if (!area || !radar) return;
    const ar = area.getBoundingClientRect();
    let x = e.clientX - ar.left - a.dx;
    let y = e.clientY - ar.top - a.dy;
    x = Math.max(8, Math.min(x, Math.max(8, ar.width - radar.offsetWidth - 8)));
    y = Math.max(8, Math.min(y, Math.max(8, ar.height - RADAR_ALT_MIN))); // mantém altura útil
    setRadarPos({ x, y });
  }
  function radarArrastarFim() {
    if (!arrasteRef.current) return;
    arrasteRef.current = null;
    setRadarPos((p) => {
      if (p) {
        try {
          localStorage.setItem(RADAR_POS_CHAVE, JSON.stringify(p));
        } catch {
          /* localStorage pode estar indisponível — a posição só não persiste */
        }
      }
      return p;
    });
  }
  function radarResetarPos() {
    setRadarPos(null);
    try {
      localStorage.removeItem(RADAR_POS_CHAVE);
    } catch {
      /* nada a fazer */
    }
  }

  // Se a janela/resolução mudar (ou a posição salva vier de uma tela maior),
  // puxa o radar de volta pra dentro da área — senão o painel some fora da tela.
  useEffect(() => {
    function reancorarNaArea() {
      const area = areaRef.current, radar = radarRef.current;
      if (!area || !radar) return;
      setRadarPos((p) => {
        if (!p) return p;
        const maxX = Math.max(8, area.clientWidth - radar.offsetWidth - 8);
        const maxY = Math.max(8, area.clientHeight - RADAR_ALT_MIN);
        const x = Math.min(Math.max(8, p.x), maxX);
        const y = Math.min(Math.max(8, p.y), maxY);
        return x === p.x && y === p.y ? p : { x, y };
      });
    }
    reancorarNaArea();
    window.addEventListener('resize', reancorarNaArea);
    return () => window.removeEventListener('resize', reancorarNaArea);
  }, [painelEmpresasAberto]);

  // Quedas RECENTES ainda piscam e mostram o nome no mapa; passado o timeout,
  // viram pino vermelho quieto. Recalcula por minuto (não a cada segundo).
  const minutoAtual = Math.floor(agora.getTime() / 60000);
  const quedasRecentes = useMemo(() => {
    const ids = new Set<number>();
    Object.entries(resumos).forEach(([id, r]) => {
      if (r.offline <= 0) return;
      // Sem data de início (caso raro), trata como recente pra não silenciar queda nova
      const min = r.offlineDesde ? minutoAtual - Math.floor(new Date(r.offlineDesde).getTime() / 60000) : 0;
      if (min < TIMEOUT_ROTULO_MIN) ids.add(Number(id));
    });
    return ids;
  }, [resumos, minutoAtual]);

  const localizadas = empresas.filter((e) => e.latitude != null && e.longitude != null).length;

  return (
    <div
      ref={containerRef}
      className={`fixed inset-0 z-[60] bg-deep-950 flex flex-col ${estado === 'offline' ? 'animate-alert-pulse' : ''}`}
    >
      {/* -------- barra superior: marca + veredito + placar + relógio -------- */}
      <header className="glass-panel rounded-none border-x-0 border-t-0 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 sm:px-8 py-3 sm:py-4 shrink-0">
        <div className="flex items-center gap-5 min-w-0">
          <LogoUptimeXNav />
          <div className="hidden md:block h-9 w-px bg-white/10" />
          <div className="min-w-0">
            <p className="eyebrow">Mapa · Suporte</p>
            {/* Sem blink: vermelho sólido já comunica — piscar cansava na TV */}
            <p className={`font-display font-semibold text-lg sm:text-2xl leading-none tracking-tight ${corEstado}`}>
              {fraseEstado}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 sm:gap-2">
          <Placar valor={empresas.length} rotulo="empresas" />
          <div className="h-10 w-px bg-white/10" />
          <Placar valor={veredito.ok} rotulo="no ar" tom="online" />
          <Placar valor={veredito.comAtencao} rotulo="atenção" tom={veredito.comAtencao > 0 ? 'warn' : 'muted'} />
          <Placar valor={veredito.comQueda} rotulo="quedas" tom={veredito.comQueda > 0 ? 'offline' : 'muted'} />
          <div className="h-10 w-px bg-white/10 hidden sm:block" />
          <Placar valor={veredito.disp} rotulo="dispositivos" />
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
              sinal vivo · {tempoRelativo(agora.getTime() - atualizadoEm)}
            </p>
          </div>
          <button
            onClick={alternarSom}
            className={`btn-ghost border ${somAtivo ? 'border-signal-500/60 text-signal-400' : 'border-white/10'}`}
            aria-pressed={somAtivo}
            aria-label={somAtivo ? 'Desligar som de alerta' : 'Ligar som de alerta'}
            title={somAtivo ? 'Som de alerta ligado' : 'Som de alerta desligado'}
          >
            {somAtivo ? '🔊 Som' : '🔇 Som'}
          </button>
          <button
            onClick={() => setNomesNoMapa((v) => !v)}
            className={`btn-ghost border ${nomesNoMapa ? 'border-signal-500/60 text-signal-400' : 'border-white/10'}`}
            aria-pressed={nomesNoMapa}
            title="Mostrar/ocultar o nome das empresas offline no mapa"
          >
            {nomesNoMapa ? 'Nomes: on' : 'Nomes: off'}
          </button>
          <button
            onClick={() => setReenquadrar((n) => n + 1)}
            className="btn-ghost border border-white/10"
            aria-label="Reenquadrar o mapa em todas as sedes"
            title="Voltar à visão geral de todas as sedes"
          >
            Reenquadrar
          </button>
          <button
            onClick={alternarTelaCheia}
            className="btn-ghost border border-white/10"
            aria-label={emTelaCheia ? 'Sair da tela cheia' : 'Entrar em tela cheia'}
          >
            {emTelaCheia ? 'Restaurar' : 'Tela cheia'}
          </button>
          <button onClick={onSair} className="btn-ghost" aria-label="Voltar ao painel">
            Sair
          </button>
        </div>
      </header>

      {/* -------- mapa em tela cheia -------- */}
      <div ref={areaRef} className="flex-1 min-h-0 relative">
        <MapaEmpresas
          empresas={empresasVisiveis}
          foco={null}
          statusPorEmpresa={statusPorEmpresa}
          modoVitrine
          onSelecionarEmpresa={onAbrirEmpresa}
          reenquadrarToken={reenquadrar}
          rotularQuedas={nomesNoMapa}
          quedasRecentes={quedasRecentes}
        />

        {/* filtros do mural: só quedas / só clientes com bloco /30 dedicado */}
        <div className="absolute top-4 left-4 z-[450] flex gap-2">
          <button
            onClick={() => setPainelEmpresasAberto((v) => !v)}
            aria-pressed={painelEmpresasAberto}
            aria-controls="mapa-tv-radar-empresas"
            className={`glass-panel px-3.5 py-1.5 text-xs font-mono rounded-lg border transition-all
              ${painelEmpresasAberto
                ? 'border-online/50 text-slate-100'
                : 'border-white/10 text-muted hover:text-slate-100 hover:border-white/25'}`}
          >
            {painelEmpresasAberto ? 'Ocultar empresas' : 'Mostrar empresas'}
          </button>
          <button
            onClick={() => setSoOffline((v) => !v)}
            aria-pressed={soOffline}
            className={`glass-panel px-3.5 py-1.5 text-xs font-mono rounded-lg border transition-all
              ${soOffline
                ? 'border-signal-500/70 text-offline shadow-glow-signal'
                : 'border-white/10 text-muted hover:text-slate-100 hover:border-white/25'}`}
          >
            ● Offline
          </button>
          <button
            onClick={() => setSoDedicado((v) => !v)}
            aria-pressed={soDedicado}
            className={`glass-panel px-3.5 py-1.5 text-xs font-mono rounded-lg border transition-all
              ${soDedicado
                ? 'border-signal-500/70 text-signal-400 shadow-glow-signal'
                : 'border-white/10 text-muted hover:text-slate-100 hover:border-white/25'}`}
          >
            /30 dedicado
          </button>
          {(soOffline || soDedicado) && (
            <span className="glass-panel px-3 py-1.5 text-[11px] font-mono text-muted rounded-lg border border-white/10">
              {empresasVisiveis.length} de {empresas.length}
            </span>
          )}
        </div>

        {/* Radar recolhível e ARRASTÁVEL: todas as empresas, falhas sempre no topo. */}
        {painelEmpresasAberto && (
          <div
            id="mapa-tv-radar-empresas"
            ref={radarRef}
            style={
              radarPos
                ? { left: radarPos.x, top: radarPos.y, maxHeight: `calc(100% - ${radarPos.y + 8}px)` }
                : undefined
            }
            className={`absolute ${radarPos ? '' : 'top-4 right-4 max-h-[calc(100%-2rem)]'} z-[450] w-80 max-w-[42vw] flex flex-col glass-panel border-white/15 overflow-hidden animate-fade-up`}
          >
            {/* barra de título = alça de arraste */}
            <div
              onPointerDown={radarArrastarInicio}
              onPointerMove={radarArrastar}
              onPointerUp={radarArrastarFim}
              onDoubleClick={radarResetarPos}
              title="Arraste para reposicionar · duplo-clique volta ao canto"
              className="px-4 py-2.5 border-b border-white/10 flex items-center justify-between shrink-0 cursor-move select-none touch-none"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="flex flex-col gap-[3px] shrink-0 text-muted/60" aria-hidden>
                  <span className="flex gap-[3px]"><span className="w-1 h-1 rounded-full bg-current" /><span className="w-1 h-1 rounded-full bg-current" /></span>
                  <span className="flex gap-[3px]"><span className="w-1 h-1 rounded-full bg-current" /><span className="w-1 h-1 rounded-full bg-current" /></span>
                  <span className="flex gap-[3px]"><span className="w-1 h-1 rounded-full bg-current" /><span className="w-1 h-1 rounded-full bg-current" /></span>
                </span>
                <div className="min-w-0">
                  <span className="block font-display font-semibold text-slate-100 text-sm">Radar de empresas</span>
                  <span className="block text-[9px] font-mono uppercase tracking-[0.18em] text-muted mt-0.5">
                    falhas no topo · arraste p/ mover
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="font-mono text-[11px] tabular-nums">
                  <span className="text-offline">{veredito.comQueda} off</span>
                  <span className="text-muted"> · </span>
                  <span className="text-online">{veredito.ok} on</span>
                </span>
                <button
                  onClick={() => setPainelEmpresasAberto(false)}
                  className="w-6 h-6 rounded-md text-muted hover:text-slate-100 hover:bg-white/10 transition-colors"
                  aria-label="Ocultar radar de empresas"
                >
                  ×
                </button>
              </div>
            </div>

            {/* busca interna: aparece quando há muitas empresas pra rolar */}
            {empresasOrdenadas.length > 8 && (
              <div className="px-3 py-2 border-b border-white/[0.06] shrink-0">
                <input
                  value={buscaRadar}
                  onChange={(ev) => setBuscaRadar(ev.target.value)}
                  placeholder={`Buscar entre ${empresasOrdenadas.length} empresas…`}
                  aria-label="Buscar empresa no radar"
                  className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs font-mono text-slate-200 placeholder:text-muted/60 outline-none focus:border-signal-500/50"
                />
              </div>
            )}

            <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-white/[0.05]">
              {radarVisivel.map(({ empresa, status, online, offline, total, desde }) => {
                const quedaRecente = status === 'offline' && quedasRecentes.has(empresa.id);
                const cor = status === 'offline' ? 'bg-offline' : status === 'degradado' ? 'bg-warn' : status === 'online' ? 'bg-online' : 'bg-muted';
                return (
                  <button
                    key={empresa.id}
                    onClick={() => onAbrirEmpresa(empresa)}
                    className={`w-full text-left px-4 py-2.5 transition-colors flex items-start justify-between gap-3 border-l-2
                      ${status === 'offline'
                        ? `border-offline hover:bg-signal-600/15 ${quedaRecente ? 'radar-queda-ativa' : 'bg-signal-600/[0.08]'}`
                        : 'border-transparent hover:bg-white/[0.04]'}`}
                  >
                    <span className="flex items-start gap-2.5 min-w-0">
                      <span className="relative flex w-2.5 h-2.5 shrink-0 mt-1">
                        {quedaRecente && <span className="absolute inline-flex h-full w-full rounded-full bg-offline/50 animate-sonar" />}
                        <span className={`relative inline-flex rounded-full w-2.5 h-2.5 ${cor}`} />
                      </span>
                      <span className="min-w-0">
                        <span className={`block font-display font-semibold text-sm truncate ${status === 'offline' ? 'text-white' : 'text-slate-200'}`}>{empresa.nome}</span>
                        <span className="block text-[11px] font-mono text-muted truncate">{empresa.endereco || 'sem localização'}</span>
                      </span>
                    </span>
                    <span className="text-right shrink-0 mt-0.5">
                      <span className={`block text-[11px] font-mono tabular-nums ${status === 'offline' ? 'text-offline' : status === 'degradado' ? 'text-warn' : status === 'online' ? 'text-online' : 'text-muted'}`}>
                        {status === 'offline' ? `${offline}/${total} fora` : total > 0 ? `${online}/${total} no ar` : 'sem monitor'}
                      </span>
                      {status === 'offline' && desde && (
                        <span className="block text-[10px] font-mono text-muted tabular-nums">{tempoDesde(desde, agora)}</span>
                      )}
                    </span>
                  </button>
                );
              })}
              {radarVisivel.length === 0 && (
                <p className="px-4 py-6 text-center text-xs font-mono text-muted">
                  {buscaRadar.trim() ? `Nada com "${buscaRadar.trim()}".` : 'Nenhuma empresa neste filtro.'}
                </p>
              )}
            </div>

            {/* rodapé: contagem total (ou filtrada), pra dar noção da frota */}
            <div className="px-4 py-1.5 border-t border-white/10 shrink-0 flex items-center justify-between font-mono text-[10px] text-muted">
              <span className="uppercase tracking-widest">Empresas</span>
              <span className="tabular-nums">
                {buscaRadar.trim() ? `${radarVisivel.length} de ${empresasOrdenadas.length}` : empresasOrdenadas.length}
              </span>
            </div>
          </div>
        )}

        {/* banner "acabou de cair" — reforça o alerta com o nome ao nível dos olhos */}
        {alerta && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[500] glass-panel border-signal-500/60 shadow-glow-signal px-5 py-3 flex items-center gap-3 animate-fade-up">
            <span className="relative flex w-3 h-3 shrink-0">
              <span className="absolute inline-flex h-full w-full rounded-full bg-offline/50 animate-sonar" />
              <span className="relative inline-flex rounded-full w-3 h-3 bg-offline" />
            </span>
            <div className="leading-tight">
              <p className="font-display font-semibold text-slate-100">
                {alerta.nome} <span className="text-offline">— sem ping</span>
              </p>
              <p className="text-[11px] font-mono text-muted">{alerta.dispositivo} parou de responder agora</p>
            </div>
          </div>
        )}

        {/* legenda flutuante */}
        <div className="absolute bottom-4 left-4 z-[400] glass-panel px-4 py-2.5 flex items-center gap-5">
          <ItemLegenda classe="status-dot-online" texto="no ar" />
          <ItemLegenda classe="status-dot-warn" texto="atenção" />
          <ItemLegenda classe="status-dot-offline" texto="queda" />
          <ItemLegenda classe="bg-muted/60" texto="sem monitor" />
          <span className="text-[11px] font-mono text-muted/70 border-l border-white/10 pl-5">
            clique numa sede p/ configurar
          </span>
        </div>

        {empresas.length > 0 && localizadas === 0 && (
          <div className="absolute inset-0 z-[400] flex items-center justify-center pointer-events-none">
            <p className="glass-panel px-5 py-3 text-muted text-sm font-mono">
              Nenhuma sede tem endereço localizado ainda — cadastre a cidade pra fixar o mapa.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
