import { useState } from 'react';
import { Empresa } from './api';
import { useAuth } from './auth/AuthContext';
import { LogoUptimeXNav } from './components/LogoUptimeX';
import { FundoCaminhos } from './components/ui/background-paths';
import { Dashboard } from './pages/Dashboard';
import { EmpresaPainel } from './pages/EmpresaPainel';
import { TelaLogin } from './pages/Login';
import { PainelMacro } from './pages/PainelMacro';
import { Admin } from './pages/Admin';
import { MapaTV } from './pages/MapaTV';

type Vista = 'dashboard' | 'macro' | 'tv' | 'empresa' | 'admin';

// Profundidade de cada vista: avançar entra da direita, voltar entra da esquerda
const PROFUNDIDADE: Record<Vista, number> = { dashboard: 0, macro: 0, tv: 0, admin: 1, empresa: 1 };

function BarraNavegacao({ vista, setVista }: { vista: Vista; setVista: (v: Vista) => void }) {
  const { usuario, isAdmin, logout } = useAuth();
  return (
    <header className="glass-panel flex items-center justify-between gap-3 px-4 sm:px-5 py-2.5 sm:py-3 mb-4 sm:mb-6">
      <div className="flex items-center gap-3 sm:gap-6 min-w-0">
        <button
          onClick={() => setVista('dashboard')}
          className="group hover:opacity-85 transition-opacity"
          aria-label="Ir para o painel inicial"
        >
          <LogoUptimeXNav />
        </button>
        <button
          onClick={() => setVista('dashboard')}
          className={`text-sm font-display transition-colors ${vista === 'dashboard' || vista === 'empresa' ? 'text-signal-400' : 'text-muted hover:text-slate-200'}`}
        >
          Painel
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
          Mapa TV
        </button>
        {isAdmin && (
          <button
            onClick={() => setVista('admin')}
            className={`text-sm font-display transition-colors ${vista === 'admin' ? 'text-signal-400' : 'text-muted hover:text-slate-200'}`}
          >
            Administração
          </button>
        )}
      </div>
      <div className="flex items-center gap-2 sm:gap-4 shrink-0">
        <div className="text-right hidden sm:block">
          <p className="text-sm text-slate-200 leading-tight">{usuario?.username}</p>
          <p className="text-[10px] uppercase tracking-widest text-muted font-mono leading-tight">{usuario?.role}</p>
        </div>
        <button onClick={logout} className="btn-ghost">Sair</button>
      </div>
    </header>
  );
}

export default function App() {
  const { usuario } = useAuth();
  const [vista, setVista] = useState<Vista>('dashboard');
  const [direcao, setDirecao] = useState<'avante' | 'volta'>('avante');
  const [empresaAtiva, setEmpresaAtiva] = useState<Empresa | null>(null);
  // De onde a empresa foi aberta, pra "voltar" retornar à origem (painel ou macro)
  const [origemEmpresa, setOrigemEmpresa] = useState<Vista>('dashboard');

  function irPara(destino: Vista) {
    setDirecao(PROFUNDIDADE[destino] >= PROFUNDIDADE[vista] ? 'avante' : 'volta');
    setVista(destino);
  }

  if (!usuario) return <TelaLogin />;

  // Mural da TV do suporte: ocupa a tela toda, fora do shell (sem navbar/margens).
  // Clicar numa sede abre o painel dela; "voltar" retorna ao próprio mapa.
  if (vista === 'tv')
    return (
      <MapaTV
        onSair={() => setVista('dashboard')}
        onAbrirEmpresa={(e) => {
          setOrigemEmpresa('tv');
          setEmpresaAtiva(e);
          irPara('empresa');
        }}
      />
    );

  function selecionarEmpresa(e: Empresa) {
    setOrigemEmpresa(vista === 'macro' ? 'macro' : 'dashboard');
    setEmpresaAtiva(e);
    irPara('empresa');
  }

  return (
    <div className="min-h-dvh p-3 sm:p-6 relative">
      <FundoCaminhos />
      <div className="max-w-7xl mx-auto">
        <BarraNavegacao vista={vista} setVista={irPara} />
        <div key={vista} className={`h-[calc(100dvh-8rem)] ${direcao === 'avante' ? 'tela-avante' : 'tela-volta'}`}>
          {vista === 'admin' && <Admin />}
          {vista === 'macro' && <PainelMacro onSelecionar={selecionarEmpresa} />}
          {vista === 'dashboard' && <Dashboard onSelecionar={selecionarEmpresa} />}
          {vista === 'empresa' && empresaAtiva && (
            <EmpresaPainel empresa={empresaAtiva} aoVoltar={() => irPara(origemEmpresa)} />
          )}
        </div>
      </div>
    </div>
  );
}
