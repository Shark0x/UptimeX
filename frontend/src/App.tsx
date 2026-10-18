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
import { IconNavAntena, IconNavAdmin } from './components/NetIcons';
import { parseUrl, syncUrlToState, type Vista, type Periodo, type SubAba } from './routing';
import { api, type DashboardRange } from './api';

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
            <IconNavAntena className="w-[18px] h-[18px]" />
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
            <IconNavAdmin className="w-[18px] h-[18px]" />
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
  // Deep link /empresas/ID/aba: id + aba alvo pra hidratar o painel após refresh.
  const [empresaIdAlvo, setEmpresaIdAlvo] = useState<number | undefined>(() => parseUrl().empresaId);
  const [subAbaEmpresa, setSubAbaEmpresa] = useState<SubAba>(() => parseUrl().subAba ?? 'status');

  // Hidrata empresaAtiva quando a URL aponta pra uma empresa que ainda não está
  // em memória (refresh/deep link direto em /empresas/ID/aba). Só roda após o
  // login estar resolvido — senão listarEmpresas() tomaria 401 no boot.
  useEffect(() => {
    if (!usuario) return;
    if (vista !== 'empresa' || !empresaIdAlvo) return;
    if (empresaAtiva && Number(empresaAtiva.id) === empresaIdAlvo) return;
    let cancelado = false;
    api
      .listarEmpresas()
      .then((lista) => {
        if (cancelado) return;
        const alvo = lista.find((e) => Number(e.id) === empresaIdAlvo);
        if (alvo) {
          setEmpresaAtiva(alvo);
          setOrigemEmpresa('dashboard');
        } else {
          // Empresa inexistente ou sem acesso: volta pra Home.
          setVista('home');
        }
      })
      .catch(() => {
        /* Falha transitória: mantém a tela de carregamento (não redireciona). */
      });
    return () => {
      cancelado = true;
    };
  }, [usuario, vista, empresaIdAlvo, empresaAtiva]);

  // Sincronizar mudanças de vista com URL (App é a única fonte da verdade do URL)
  useEffect(() => {
    const rota = rotaFromVista(vista);
    // empresaId: usa o da empresa carregada ou, enquanto hidrata, o alvo da URL
    const empresaId = empresaAtiva?.id != null ? Number(empresaAtiva.id) : empresaIdAlvo;
    syncUrlToState({
      vista: rota,
      empresaId,
      subAba: rota === 'empresa' ? subAbaEmpresa : undefined,
      focarEmpresa: focarEmpresaMapa,
      periodo: rota === 'home' ? periodoHome : undefined,
    });
  }, [vista, empresaAtiva?.id, empresaIdAlvo, subAbaEmpresa, focarEmpresaMapa, periodoHome]);

  // Listener para botão voltar/avançar do navegador
  useEffect(() => {
    function handlePopstate() {
      const route = parseUrl();
      const novaVista = vistaFromRoute(route.vista);
      setVista(novaVista);
      setFocarEmpresaMapa(route.focarEmpresa);
      if (route.vista === 'home') setPeriodoHome(route.periodo ?? '30d');
      if (route.vista === 'empresa') {
        setEmpresaIdAlvo(route.empresaId);
        setSubAbaEmpresa(route.subAba ?? 'status');
      }
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
          onFecharFoco={() => setFocarEmpresaMapa(undefined)}
          onSair={() => {
            setFocarEmpresaMapa(undefined);
            setVista('dashboard');
          }}
          onAbrirEmpresa={(e) => {
            setOrigemEmpresa('tv');
            setEmpresaAtiva(e);
            // Sincroniza empresaIdAlvo/subAba com a empresa clicada. Sem isto, um
            // empresaIdAlvo ANTIGO (de uma empresa aberta antes) sobrevive e o
            // efeito de hidratação troca/derruba a navegação — abrir uma empresa
            // do radar acabava caindo na Home ("sair").
            setEmpresaIdAlvo(Number(e.id));
            setSubAbaEmpresa('status');
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
    setEmpresaIdAlvo(Number(e.id));
    setSubAbaEmpresa('status');
    irPara('empresa');
  }

  // Abre o Mapa focado numa empresa (deep link /mapa?empresa=ID em ação).
  // Number(): o id da empresa vem como STRING do backend; sem coagir, o MapaTV
  // compara Number(e.id) === focarEmpresaId (número === string) e nunca foca —
  // era por isso que o "Ver no mapa" do menu 3-pontinhos não funcionava.
  function verNoMapa(empresaId: number) {
    setFocarEmpresaMapa(Number(empresaId));
    setVista('tv');
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
          {vista === 'dashboard' && <Dashboard onSelecionar={selecionarEmpresa} onVerNoMapa={verNoMapa} />}
          {vista === 'antenas' && (
            <Suspense fallback={<div className="h-full flex items-center justify-center text-sm font-mono text-muted">Carregando módulo de antenas...</div>}>
              <Antenas onAbrirVisualizacaoTV={() => setVista('antenas-tv')} />
            </Suspense>
          )}
          {vista === 'empresa' && empresaAtiva && (
            <EmpresaPainel
              key={empresaAtiva.id}
              empresa={empresaAtiva}
              aoVoltar={() => irPara(origemEmpresa)}
              onVerNoMapa={() => verNoMapa(Number(empresaAtiva.id))}
              abaInicial={subAbaEmpresa}
              onAbaChange={(a) => setSubAbaEmpresa(a)}
            />
          )}
          {vista === 'empresa' && !empresaAtiva && (
            <div className="h-full flex items-center justify-center text-sm font-mono text-muted animate-pulse">
              Carregando empresa…
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
