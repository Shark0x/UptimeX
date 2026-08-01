import { useEffect, useMemo, useRef, useState } from 'react';
import { api, Empresa, socket, StatusGlobalPayload } from '../api';
import { MapaEmpresas, StatusMarcador } from '../components/MapaEmpresas';
import { LogoUptimeXNav } from '../components/LogoUptimeX';

// Quanto tempo o banner "acabou de cair" fica à mostra no topo
const DURACAO_BANNER_MS = 12000;

// Mesmo ritmo do restante do painel: pinos e números vivos sem refresh manual
const INTERVALO_ATUALIZACAO_MS = 15000;

// Queda "aposenta" o rótulo do nome após esse tempo: o suporte já viu, então o
// balão sai e sobra só o pino vermelho quieto (o painel lateral segue listando).
const TIMEOUT_ROTULO_MIN = 40;

interface ResumoEmpresa {
  total: number;
  online: number;
  offline: number;
  degradados: number;
  links: number;
  offlineDesde: string | null;
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
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [resumos, setResumos] = useState<Record<number, ResumoEmpresa>>({});
  const [atualizadoEm, setAtualizadoEm] = useState<number>(Date.now());
  const [agora, setAgora] = useState<Date>(new Date());
  const [emTelaCheia, setEmTelaCheia] = useState(false);
  const [reenquadrar, setReenquadrar] = useState(0);
  const [nomesNoMapa, setNomesNoMapa] = useState(true);
  // Filtros do mural: só quem está fora do ar / só clientes com bloco /30 dedicado
  const [soOffline, setSoOffline] = useState(false);
  const [soDedicado, setSoDedicado] = useState(false);
  const [somAtivo, setSomAtivo] = useState(false);
  const [alerta, setAlerta] = useState<{ nome: string; dispositivo: string; em: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Refs pra usar dentro do listener do socket sem re-registrar a cada render
  const empresasRef = useRef<Empresa[]>([]);
  const somAtivoRef = useRef(false);
  const audioRef = useRef<AudioContext | null>(null);
  const bannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function carregar() {
    try {
      const [lista, resumoLista] = await Promise.all([api.listarEmpresas(), api.resumoStatusEmpresas()]);
      setEmpresas(lista);
      setResumos(
        Object.fromEntries(
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
        )
      );
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

  // Empresas fora do ar → lista lateral (pior primeiro). Substitui os balões
  // que se sobrepunham no mapa: aqui o nome é sempre legível, sem colisão.
  const quedas = useMemo(
    () =>
      empresasVisiveis
        .filter((e) => statusPorEmpresa[e.id] === 'offline')
        .map((e) => ({
          empresa: e,
          offline: resumos[e.id]?.offline ?? 0,
          total: resumos[e.id]?.total ?? 0,
          desde: resumos[e.id]?.offlineDesde ?? null,
        }))
        .sort((a, b) => b.offline - a.offline || a.empresa.nome.localeCompare(b.empresa.nome)),
    [empresasVisiveis, statusPorEmpresa, resumos]
  );

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
      <div className="flex-1 min-h-0 relative">
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

        {/* painel lateral: quedas agora — nomes legíveis, sem sobrepor no mapa */}
        {quedas.length > 0 && (
          <div className="absolute top-4 right-4 z-[450] w-72 max-w-[38vw] max-h-[calc(100%-2rem)] flex flex-col glass-panel border-signal-500/40 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-white/10 flex items-center justify-between shrink-0">
              <span className="flex items-center gap-2 font-display font-semibold text-slate-100 text-sm">
                <span className="relative flex w-2.5 h-2.5">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-offline/50 animate-sonar" />
                  <span className="relative inline-flex rounded-full w-2.5 h-2.5 bg-offline" />
                </span>
                Quedas agora
              </span>
              <span className="stat-number text-offline text-lg tabular-nums leading-none">{quedas.length}</span>
            </div>
            <div className="overflow-y-auto divide-y divide-white/[0.05]">
              {quedas.map(({ empresa, offline, total, desde }) => (
                <button
                  key={empresa.id}
                  onClick={() => onAbrirEmpresa(empresa)}
                  className="w-full text-left px-4 py-2.5 hover:bg-signal-600/10 transition-colors flex items-start justify-between gap-2"
                >
                  <span className="min-w-0">
                    <span className="block font-display font-semibold text-slate-100 text-sm truncate">{empresa.nome}</span>
                    <span className="block text-[11px] font-mono text-muted truncate">{empresa.endereco || 'sem localização'}</span>
                  </span>
                  <span className="text-right shrink-0 mt-0.5">
                    <span className="block text-[11px] font-mono text-offline tabular-nums">{offline}/{total} fora</span>
                    {desde && (
                      <span className="block text-[10px] font-mono text-muted tabular-nums">{tempoDesde(desde, agora)}</span>
                    )}
                  </span>
                </button>
              ))}
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
