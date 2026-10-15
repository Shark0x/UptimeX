import { lazy, Suspense, useState, useEffect } from 'react';
import { Empresa } from './api';
import { useAuth } from './auth/AuthContext';
import { LogoUptimeXNav } from './components/LogoUptimeX';
import { FundoCaminhos } from './components/ui/background-paths';
import { Dashboard } from './pages/Dashboard';
import { DashboardHome } from './pages/DashboardHome';
import { EmpresaPainel } from './pages/EmpresaPainel';
import { TelaLogin } from './pages/Login';
import { PainelMacro } from './pages/PainelMacro';
import { Admin } from './pages/Admin';
import { MapaTV } from './pages/MapaTV';
import { PerfilMenu } from './components/PerfilMenu';
import { parseUrl, syncUrlToState, type Vista, type Periodo } from './routing';
import type { DashboardRange } from './api';

// Lazy: React Flow (mapa de topologia) só entra no bundle quando a aba é aberta
const Antenas = lazy(() => import('./pages/Antenas').then((m) => ({ default: m.Antenas })));
const AntenaMapaTV = lazy(() => import('./pages/AntenaMapaTV').then((m) => ({ default: m.AntenaMapaTV })));

// Vista interna ↔ rota. 'home' = nova Home macro; 'macro' = PainelMacro (Visão Macro).
type VistaInterna = 'home' | 'dashboard' | 'macro' | 'tv' | 'antenas' | 'antenas-tv' | 'empresa' | 'admin';
function vistaFromRoute(rota: Vista): VistaInterna {
  switch (rota) {
    case 'home': return 'home';
    case 'macro': return 'macro';
    case 'empresas': return 'dashboard';
    case 'mapa': return 'tv';
    case 'empresa': return 'empresa';
    case 'antenas': return 'antenas';
    case 'antenas-tv': return 'antenas-tv';
    case 'admin': return 'admin';
    default: return 'home';
  }
}

function rotaFromVista(vista: VistaInterna): Vista {
  switch (vista) {
    case 'home': return 'home';
    case 'macro': return 'macro';
    case 'dashboard': return 'empresas';
    case 'tv': return 'mapa';
    case 'empresa': return 'empresa';
    case 'antenas': return 'antenas';
    case 'antenas-tv': return 'antenas-tv';
    case 'admin': return 'admin';
    default: return 'home';
  }
}

// Profundidade de cada vista: avançar entra da direita, voltar entra da esquerda
const PROFUNDIDADE: Record<VistaInterna, number> = { home: 0, dashboard: 0, macro: 0, tv: 0, antenas: 0, 'antenas-tv': 0, admin: 1, empresa: 1 };

function BarraNavegacao({ vista, setVista }: { vista: VistaInterna; setVista: (v: VistaInterna) => void }) {
  const { isAdmin, logout } = useAuth();
  return (
    <header className="glass-panel relative z-50 flex items-center justify-between gap-3 px-4 sm:px-5 py-2.5 sm:py-3 mb-4 sm:mb-6">
      <div className="flex items-center gap-3 sm:gap-6 min-w-0 flex-wrap sm:flex-nowrap">
        <button
          onClick={() => setVista('home')}
          className="group hover:opacity-85 transition-opacity"
          aria-label="Ir para o painel inicial"
        >
          <LogoUptimeXNav />
        </button>
        <button
          onClick={() => setVista('home')}
          className={`text-sm font-display transition-colors ${vista === 'home' ? 'text-signal-400' : 'text-muted hover:text-slate-200'}`}
        >
          Painel
        </button>
        <button
          onClick={() => setVista('dashboard')}
          className={`text-sm font-display transition-colors ${vista === 'dashboard' || vista === 'empresa' ? 'text-signal-400' : 'text-muted hover:text-slate-200'}`}
        >
          Empresas
        </button>
        <button
          onClick={() => setVista('macro')}
          className={`text-sm font-display transition-colors ${vista === 'macro' ? 'text-signal-400' : 'text-muted hover:text-slate-200'}`}
        >
          Visão Macro
        </button>
        <button
          onClick={() => setVista('tv')}
          className={`text-sm font-display transition-colors ${vista === 'tv' ? 'text-signal-400' : 'text-muted hover:text-slate-200'}`}
        >
          Mapa
        </button>
      </div>
      <div className="flex items-center gap-3 sm:gap-4 shrink-0">
        {/* Antenas: visível a todo staff; operador/visualizador veem em modo leitura */}
        <button
            onClick={() => setVista('antenas')}
            className={`group w-9 h-9 shrink-0 rounded-full border flex items-center justify-center transition-all ${
            vista === 'antenas' || vista === 'antenas-tv'
              ? 'border-signal-500/60 bg-signal-600/20 text-signal-400 shadow-glow-signal'
              : 'border-white/10 text-muted hover:border-signal-500/40 hover:text-signal-400'
          }`}
            title="Antenas"
            aria-label="Antenas"
          >
            <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d="M4.9 16.1C1 12.2 1 5.8 4.9 1.9" />
              <path d="M7.8 4.7a6.14 6.14 0 0 0-.8 7.5" />
              <circle cx="12" cy="9" r="2" />
              <path d="M16.2 4.8c2 2 2.26 5.11 .8 7.47" />
              <path d="M19.1 1.9c3.9 3.9 3.9 10.3 0 14.2" />
              <path d="M9.5 18h5" />
              <path d="m8 22 4-11 4 11" />
            </svg>
          </button>
        {isAdmin && (
          <button
            onClick={() => setVista('admin')}
            className={`group w-9 h-9 shrink-0 rounded-full border flex items-center justify-center transition-all ${
              vista === 'admin'
                ? 'border-signal-500/60 bg-signal-600/20 text-signal-400 shadow-glow-signal'
                : 'border-white/10 text-muted hover:border-signal-500/40 hover:text-signal-400'
            }`}
            title="Configurações"
            aria-label="Configurações"
          >
            <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        )}
        <span className="w-px h-5 bg-white/10" />
        <PerfilMenu onLogout={logout} />
      </div>
    </header>
  );
}

export default function App() {
  const { usuario } = useAuth();
  const [vista, setVista] = useState<VistaInterna>(() => {
    const route = parseUrl();
    return vistaFromRoute(route.vista);
  });
  const [direcao, setDirecao] = useState<'avante' | 'volta'>('avante');
  const [empresaAtiva, setEmpresaAtiva] = useState<Empresa | null>(null);
  const [origemEmpresa, setOrigemEmpresa] = useState<VistaInterna>('dashboard');
  const [focarEmpresaMapa, setFocarEmpresaMapa] = useState<number | undefined>(() => {
    const route = parseUrl();
    return route.focarEmpresa;
  });
  // Filtro de período da Home (?periodo=30d). Default 30d quando ausente na URL.
  const [periodoHome, setPeriodoHome] = useState<Periodo>(() => {
    const route = parseUrl();
    return route.periodo ?? '30d';
  });

  // Sincronizar mudanças de vista com URL (App é a única fonte da verdade do URL)
  useEffect(() => {
    const rota = rotaFromVista(vista);
    syncUrlToState({
      vista: rota,
      empresaId: empresaAtiva?.id,
      focarEmpresa: focarEmpresaMapa,
      periodo: rota === 'home' ? periodoHome : undefined,
    });
  }, [vista, empresaAtiva?.id, focarEmpresaMapa, periodoHome]);

  // Listener para botão voltar/avançar do navegador
  useEffect(() => {
    function handlePopstate() {
      const route = parseUrl();
      const novaVista = vistaFromRoute(route.vista);
      setVista(novaVista);
      setFocarEmpresaMapa(route.focarEmpresa);
      if (route.vista === 'home') setPeriodoHome(route.periodo ?? '30d');
    }

    window.addEventListener('popstate', handlePopstate);
    return () => window.removeEventListener('popstate', handlePopstate);
  }, []);

  function irPara(destino: VistaInterna) {
    setDirecao(PROFUNDIDADE[destino] >= PROFUNDIDADE[vista] ? 'avante' : 'volta');
    setVista(destino);
  }

  if (!usuario) return <TelaLogin />;

  // Mural da TV do suporte: ocupa a tela toda, fora do shell (sem navbar/margens).
  // Clicar numa sede abre o painel dela; "voltar" retorna ao próprio mapa.
  if (vista === 'tv')
    return (
      <div className="tema-escuro-fixo">
        <MapaTV
          focarEmpresaId={focarEmpresaMapa}
          onSair={() => {
            setFocarEmpresaMapa(undefined);
            setVista('dashboard');
          }}
          onAbrirEmpresa={(e) => {
            setOrigemEmpresa('tv');
            setEmpresaAtiva(e);
            setFocarEmpresaMapa(undefined);
            irPara('empresa');
          }}
        />
      </div>
    );

  // Visualização fullscreen do mapa de antenas: mesmo mecanismo do Mapa TV, mas
  // "voltar" retorna ao editor de Antenas (não ao painel inicial).
  if (vista === 'antenas-tv')
    return (
      <div className="tema-escuro-fixo">
        <Suspense fallback={<div className="fixed inset-0 z-[60] bg-deep-950 flex items-center justify-center text-sm font-mono text-muted">Carregando visualização...</div>}>
          <AntenaMapaTV onSair={() => setVista('antenas')} />
        </Suspense>
      </div>
    );

  function selecionarEmpresa(e: Empresa) {
    setOrigemEmpresa(vista === 'macro' ? 'macro' : vista === 'home' ? 'home' : 'dashboard');
    setEmpresaAtiva(e);
    irPara('empresa');
  }

  return (
    <div className="min-h-dvh overflow-x-hidden p-3 sm:p-6 relative">
      <FundoCaminhos />
      <div className="max-w-7xl mx-auto">
        <BarraNavegacao vista={vista} setVista={irPara} />
        <div key={vista} className={`h-[calc(100dvh-8rem)] ${direcao === 'avante' ? 'tela-avante' : 'tela-volta'}`}>
          {vista === 'admin' && <Admin />}
          {vista === 'home' && (
            <DashboardHome
              onSelecionarEmpresa={selecionarEmpresa}
              range={periodoHome as DashboardRange}
              onRangeChange={(r) => setPeriodoHome(r as Periodo)}
            />
          )}
          {vista === 'macro' && <PainelMacro onSelecionar={selecionarEmpresa} />}
          {vista === 'dashboard' && <Dashboard onSelecionar={selecionarEmpresa} />}
          {vista === 'antenas' && (
            <Suspense fallback={<div className="h-full flex items-center justify-center text-sm font-mono text-muted">Carregando módulo de antenas...</div>}>
              <Antenas onAbrirVisualizacaoTV={() => setVista('antenas-tv')} />
            </Suspense>
          )}
          {vista === 'empresa' && empresaAtiva && (
            <EmpresaPainel empresa={empresaAtiva} aoVoltar={() => irPara(origemEmpresa)} />
          )}
        </div>
      </div>
    </div>
  );
}
