import { socket } from './api';

const HOST_ATUAL = window.location.hostname || 'localhost';
const PROTOCOLO_ATUAL = window.location.protocol === 'https:' ? 'https:' : 'http:';
const API_BASE = import.meta.env.VITE_API_URL || `${PROTOCOLO_ATUAL}//${HOST_ATUAL}:4000/api`;

export type FabricanteAntena = 'ubiquiti' | 'mikrotik' | 'mimosa' | 'intelbras' | 'cambium' | 'cisco' | 'outro';

export type TipoWireless =
  | 'ptp_master'
  | 'ptp_slave'
  | 'ptmp_ap'
  | 'ptmp_station'
  | 'torre'
  | 'switch_torre'
  | 'repetidora'
  | 'outro';

export type TipoEnlace = 'ptp_wireless' | 'ptmp_wireless' | 'cabo_poe' | 'fibra_torre' | 'backup_radio';

export interface AntenaWireless {
  id: number;
  nome: string;
  ip: string;
  fabricante: FabricanteAntena;
  modelo: string | null;
  tipo_wireless: TipoWireless;
  frequencia_mhz: number | null;
  largura_canal_mhz: number | null;
  ssid: string | null;
  sinal_esperado_dbm: number | null;
  intervalo_polling_seg: number;
  status_atual: 'online' | 'offline' | 'desconhecido';
  latencia_ms: number | null;
  perda_pct: number | null;
  ultima_verificacao: string | null;
  ativo: boolean;
  criado_em?: string;
}

export interface AntenaNode {
  id: number;
  antena_id: number | null;
  label: string;
  tipo_visual: string;
  pos_x: number;
  pos_y: number;
  ip?: string;
  fabricante?: FabricanteAntena;
  modelo?: string;
  tipo_wireless?: TipoWireless;
  frequencia_mhz?: number | null;
  largura_canal_mhz?: number | null;
  ssid?: string | null;
  sinal_esperado_dbm?: number | null;
  status_atual?: 'online' | 'offline' | 'desconhecido';
  latencia_ms?: number | null;
  perda_pct?: number | null;
  ultima_verificacao?: string | null;
}

export interface AntenaEdge {
  id: number;
  origem_node_id: number;
  destino_node_id: number;
  tipo_enlace: TipoEnlace;
  label: string | null;
  frequencia: string | null;
  distancia_km: number | null;
  capacidade_mbps: number | null;
  cor: string | null;
  curvo: boolean;
  espessura: number | null;
  estilo: EstiloEnlace | null;
  animado: boolean | null;
  origem_lado: LadoEnlace | null;
  destino_lado: LadoEnlace | null;
  formato: FormatoEnlace | null;
  mostrar_label: boolean;
}

export type EstiloEnlace = 'solida' | 'tracejada' | 'pontilhada';
// Lado (handle) de ancoragem de cada ponta. 'auto' escolhe o mais proximo.
export type LadoEnlace = 'auto' | 'topo' | 'base' | 'esq' | 'dir';
// Tracado da linha: reta, curva ou zigue-zague "raio" (link wireless, estilo Dude).
export type FormatoEnlace = 'reta' | 'curva' | 'raio';

export interface AntenaTopologyData {
  nodes: AntenaNode[];
  edges: AntenaEdge[];
  viewport: { pos_x: number; pos_y: number; zoom: number; ocultar_labels?: boolean };
}

export interface AntenaMetrica {
  latencia_ms: number | null;
  perda_pct: number;
  timestamp: string;
}

export interface NovaAntenaPayload {
  nome: string;
  ip: string;
  fabricante: FabricanteAntena;
  modelo?: string;
  tipo_wireless: TipoWireless;
  frequencia_mhz?: number | null;
  largura_canal_mhz?: number | null;
  ssid?: string;
  sinal_esperado_dbm?: number | null;
  intervalo_polling_seg?: number;
  criar_no_topologia?: boolean;
  pos_x?: number;
  pos_y?: number;
  tipo_visual?: string;
}

async function req<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  const method = String(options.method || 'GET').toUpperCase();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const csrf = document.cookie
      .split(';')
      .map((item) => item.trim())
      .find((item) => item.startsWith('netmonitor_csrf='))
      ?.slice('netmonitor_csrf='.length);
    if (csrf) headers['X-CSRF-Token'] = decodeURIComponent(csrf);
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/antenas${path}`, {
      ...options,
      credentials: 'include',
      headers,
    });
  } catch {
    throw new Error('SEM_CONEXAO');
  }

  if (res.status === 401) {
    window.dispatchEvent(new Event('netmonitor:unauthorized'));
  }
  if (!res.ok) {
    const corpo = await res.json().catch(() => ({}));
    throw new Error(corpo.erro || `Erro na API: ${res.status}`);
  }
  if (res.status === 204) return null as unknown as T;
  return res.json();
}

export const antenasApi = {
  listarAntenas: (): Promise<AntenaWireless[]> => req('/'),
  criarAntena: (payload: NovaAntenaPayload): Promise<AntenaWireless & { node_id?: number }> =>
    req('/', { method: 'POST', body: JSON.stringify(payload) }),
  editarAntena: (id: number, payload: Partial<AntenaWireless>) =>
    req(`/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  removerAntena: (id: number) => req(`/${id}`, { method: 'DELETE' }),

  pingInstantaneo: (id: number): Promise<{ alcancavel: boolean; latenciaMs: number | null; perdaPct: number }> =>
    req(`/${id}/ping`, { method: 'POST' }),
  pingTodos: () => req('/ping-todos', { method: 'POST' }),

  metricasAntena: (id: number, minutos: number = 60): Promise<AntenaMetrica[]> =>
    req(`/${id}/metricas?minutos=${minutos}`),

  obterTopologia: (): Promise<AntenaTopologyData> => req('/topologia'),
  criarNode: (payload: { antena_id?: number | null; label: string; tipo_visual: string; pos_x: number; pos_y: number }): Promise<AntenaNode> =>
    req<AntenaNode>('/topologia/nodes', { method: 'POST', body: JSON.stringify(payload) }),
  editarNode: (id: number, payload: { label?: string; tipo_visual?: string }) =>
    req<{ ok: boolean }>(`/topologia/nodes/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  moverNode: (id: number, pos_x: number, pos_y: number) =>
    req<{ ok: boolean }>(`/topologia/nodes/${id}/posicao`, { method: 'PUT', body: JSON.stringify({ pos_x, pos_y }) }),
  removerNode: (id: number) => req<void>(`/topologia/nodes/${id}`, { method: 'DELETE' }),

  criarEdge: (payload: {
    origem_node_id: number;
    destino_node_id: number;
    tipo_enlace: TipoEnlace;
    label?: string;
    frequencia?: string;
    distancia_km?: number | null;
    capacidade_mbps?: number | null;
    cor?: string | null;
    curvo?: boolean;
    espessura?: number | null;
    estilo?: EstiloEnlace | null;
    animado?: boolean | null;
    origem_lado?: LadoEnlace | null;
    destino_lado?: LadoEnlace | null;
    formato?: FormatoEnlace | null;
    mostrar_label?: boolean;
  }): Promise<AntenaEdge> => req<AntenaEdge>('/topologia/edges', { method: 'POST', body: JSON.stringify(payload) }),
  editarEdge: (id: number, payload: {
    tipo_enlace?: TipoEnlace;
    label?: string;
    cor?: string | null;
    curvo?: boolean;
    frequencia?: string;
    distancia_km?: number | null;
    capacidade_mbps?: number | null;
    espessura?: number | null;
    estilo?: EstiloEnlace | null;
    animado?: boolean | null;
    origem_lado?: LadoEnlace | null;
    destino_lado?: LadoEnlace | null;
    formato?: FormatoEnlace | null;
    mostrar_label?: boolean;
    // Reconexão pelo canvas (arrastar a ponta para outro nó).
    origem_node_id?: number;
    destino_node_id?: number;
  }): Promise<AntenaEdge> => req<AntenaEdge>(`/topologia/edges/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  removerEdge: (id: number) => req<void>(`/topologia/edges/${id}`, { method: 'DELETE' }),

  salvarViewport: (pos_x: number, pos_y: number, zoom: number) =>
    req('/topologia/viewport', { method: 'PUT', body: JSON.stringify({ pos_x, pos_y, zoom }) }),
  // Config global do board (compartilhada entre telas): ocultar todos os rotulos.
  salvarConfigMapa: (ocultar_labels: boolean): Promise<{ ok: boolean; ocultar_labels: boolean }> =>
    req('/topologia/config', { method: 'PUT', body: JSON.stringify({ ocultar_labels }) }),
};

export { socket };
