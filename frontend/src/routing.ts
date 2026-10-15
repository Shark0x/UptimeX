// Roteamento leve baseado em History API + URLSearchParams
// Sem dependências externas, apenas sincronização URL ↔ estado

export type Vista = 'home' | 'empresas' | 'mapa' | 'antenas' | 'antenas-tv' | 'empresa' | 'admin';
export type SubAba = 'status' | 'topologia' | 'links' | 'historico';

export interface RouteState {
  vista: Vista;
  empresaId?: number;
  subAba?: SubAba;
  focarEmpresa?: number; // Para /mapa?empresa=ID
}

// Parse URL para obter RouteState
export function parseUrl(): RouteState {
  const path = window.location.pathname;
  const search = new URLSearchParams(window.location.search);

  // Redirect legado: /mapa-tv, /tv → /mapa
  if (path === '/mapa-tv' || path === '/tv') {
    window.history.replaceState(null, '', '/mapa');
    return { vista: 'mapa' };
  }

  // Root → home (será macro, mas preparado para futura Home)
  if (path === '/' || path === '') {
    return { vista: 'home' };
  }

  // /empresas → dashboard (configuração)
  if (path === '/empresas') {
    return { vista: 'empresas' };
  }

  // /mapa?empresa=ID
  if (path === '/mapa') {
    const focar = search.get('empresa');
    return {
      vista: 'mapa',
      focarEmpresa: focar ? parseInt(focar, 10) : undefined,
    };
  }

  // /empresas/ID/status|topologia|links|historico
  const empresaMatch = path.match(/^\/empresas\/(\d+)(?:\/(status|topologia|links|historico))?$/);
  if (empresaMatch) {
    const empresaId = parseInt(empresaMatch[1], 10);
    const subAba = (empresaMatch[2] as SubAba | undefined) || 'status';
    return { vista: 'empresa', empresaId, subAba };
  }

  // /antenas-tv
  if (path === '/antenas-tv' || path === '/antenas/tv') {
    return { vista: 'antenas-tv' };
  }

  // /antenas
  if (path === '/antenas') {
    return { vista: 'antenas' };
  }

  // /admin
  if (path === '/admin') {
    return { vista: 'admin' };
  }

  // Default: home
  return { vista: 'home' };
}

// Gera URL a partir de RouteState
export function buildUrl(state: RouteState): string {
  switch (state.vista) {
    case 'home':
      return '/';
    case 'empresas':
      return '/empresas';
    case 'mapa':
      if (state.focarEmpresa) {
        return `/mapa?empresa=${state.focarEmpresa}`;
      }
      return '/mapa';
    case 'empresa':
      if (state.empresaId) {
        const subPath = state.subAba ? `/${state.subAba}` : '/status';
        return `/empresas/${state.empresaId}${subPath}`;
      }
      return '/';
    case 'antenas-tv':
      return '/antenas-tv';
    case 'antenas':
      return '/antenas';
    case 'admin':
      return '/admin';
    default:
      return '/';
  }
}

// Sincroniza URL com o estado (sem recarregar a página)
export function syncUrlToState(state: RouteState): void {
  const url = buildUrl(state);
  const currentUrl = window.location.pathname + window.location.search;
  if (url !== currentUrl) {
    window.history.pushState(state, '', url);
  }
}

// Substitui o URL atual no histórico (para não deixar lixo ao clicar botão)
export function replaceUrl(state: RouteState): void {
  const url = buildUrl(state);
  window.history.replaceState(state, '', url);
}

// Helper: quando usuário clica botão voltar/avançar
export function getCurrentState(): RouteState {
  return parseUrl();
}
