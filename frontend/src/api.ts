import { io } from 'socket.io-client';

// Deriva o backend do host atual: abrindo pelo IP da máquina (ex: celular na
// mesma rede), a API segue junto em vez de apontar pro "localhost" do aparelho.
const HOST_ATUAL = window.location.hostname || 'localhost';
const API_BASE = import.meta.env.VITE_API_URL || `http://${HOST_ATUAL}:4000/api`;
export const STATIC_BASE = API_BASE.replace(/\/api\/?$/, '');
export const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || `http://${HOST_ATUAL}:4000`;

export const socket = io(SOCKET_URL, { autoConnect: false });

let authToken: string | null = localStorage.getItem('netmonitor_token');

export function setAuthToken(token: string | null) {
  authToken = token;
  if (token) {
    localStorage.setItem('netmonitor_token', token);
    socket.auth = { token };
    socket.connect();
  } else {
    localStorage.removeItem('netmonitor_token');
    socket.disconnect();
  }
}

if (authToken) {
  socket.auth = { token: authToken };
  socket.connect();
}

async function req(path: string, options: RequestInit = {}) {
  const isFormData = options.body instanceof FormData;
  const headers: Record<string, string> = isFormData ? {} : { 'Content-Type': 'application/json' };
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: { ...headers, ...(options.headers as Record<string, string> | undefined) },
    });
  } catch {
    // fetch só lança assim quando não conseguiu nem falar com o servidor
    // (rede, servidor fora do ar, porta bloqueada) — nunca por credencial errada.
    throw new Error('SEM_CONEXAO');
  }

  if (res.status === 401) {
    window.dispatchEvent(new Event('netmonitor:unauthorized'));
  }
  if (!res.ok) {
    const corpo = await res.json().catch(() => ({}));
    throw new Error(corpo.erro || `Erro na API: ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export type Papel = 'admin' | 'visualizador';

export interface Usuario {
  id: number;
  username: string;
  role: Papel;
}

export interface UsuarioListado extends Usuario {
  ativo: boolean;
  criado_em: string;
}

export interface Empresa {
  id: number;
  nome: string;
  descricao?: string;
  foto_url?: string | null;
  endereco?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export interface ResumoStatusEmpresa {
  id: number;
  nome: string;
  foto_url: string | null;
  endereco: string | null;
  total: number;
  online: number;
  offline: number;
  degradados: number;
  desconhecidos: number;
  links_dedicados: number;
}

export interface NovaEmpresaPayload {
  nome: string;
  descricao: string;
  foto: File | null;
  endereco?: string;
  latitude?: number | null;
  longitude?: number | null;
}

/** Geocodifica um endereço via Nominatim (OpenStreetMap) direto do navegador. */
export async function geocodificarEndereco(
  endereco: string
): Promise<{ latitude: number; longitude: number; rotulo: string } | null> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=pt-BR&q=${encodeURIComponent(endereco)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) return null;
  const lista = await res.json();
  if (!Array.isArray(lista) || lista.length === 0) return null;
  return {
    latitude: Number(lista[0].lat),
    longitude: Number(lista[0].lon),
    rotulo: String(lista[0].display_name || endereco),
  };
}

export interface Dispositivo {
  id: number;
  empresa_id: number;
  nome: string;
  ip: string;
  fabricante: string;
  metodo_monitoramento: 'snmp' | 'ping' | 'snmp+ping';
  comunidade_snmp: string;
  porta_snmp: number;
  intervalo_polling_seg: number;
  status_atual: 'online' | 'offline' | 'desconhecido';
  ultima_verificacao: string | null;
  latencia_ms: number | null;
  perda_pct: number | null;
  ativo: boolean;
}

export interface PingMetrica {
  latencia_ms: number | null;
  perda_pct: number;
  timestamp: string;
}

/** Payload dos eventos socket `heartbeat` e `status_mudou` */
export interface HeartbeatPayload {
  dispositivoId: number;
  status?: 'online' | 'offline';
  statusNovo?: 'online' | 'offline';
  latenciaMs: number | null;
  perdaPct: number | null;
  timestamp: string;
}

/** Payload do evento socket global `status_global` — usado pelo mural da TV */
export interface StatusGlobalPayload {
  empresaId: number;
  dispositivoId: number;
  dispositivo: string;
  statusNovo: 'online' | 'offline';
  timestamp: string;
}

/** Limiares de degradação usados em toda a interface */
export const LIMIAR_LATENCIA_MS = 150;
export const LIMIAR_PERDA_PCT = 2;

export type SaudeDispositivo = 'online' | 'offline' | 'degradado' | 'desconhecido';

export function saudeDispositivo(d: Pick<Dispositivo, 'status_atual' | 'latencia_ms' | 'perda_pct'>): SaudeDispositivo {
  if (d.status_atual === 'offline') return 'offline';
  if (d.status_atual === 'desconhecido') return 'desconhecido';
  if (
    (d.latencia_ms !== null && d.latencia_ms >= LIMIAR_LATENCIA_MS) ||
    (d.perda_pct !== null && d.perda_pct >= LIMIAR_PERDA_PCT)
  ) {
    return 'degradado';
  }
  return 'online';
}

export interface StatusEvento {
  id: number;
  dispositivo_id: number;
  status: 'online' | 'offline';
  inicio: string;
  fim: string | null;
  duracao_segundos: number | null;
}

export interface TopoNode {
  id: number;
  empresa_id: number;
  dispositivo_id: number | null;
  label: string;
  tipo: string;
  pos_x: number;
  pos_y: number;
  status_atual?: string;
  ip?: string;
}

export interface TopoEdge {
  id: number;
  empresa_id: number;
  node_origem: number;
  node_destino: number;
  label?: string;
}

export interface LinkDedicado {
  id: number;
  empresa_id: number;
  bloco: string;
  descricao: string | null;
  criado_em: string;
}

export interface AuditoriaItem {
  id: number;
  usuario: string;
  acao: string;
  entidade: string;
  entidade_id: number | null;
  detalhes: string;
  timestamp: string;
}

export interface AcessoItem {
  id: number;
  usuario: string;
  acao: 'login' | 'login_falhou';
  ip_origem: string | null;
  pais: string | null;
  regiao: string | null;
  cidade: string | null;
  timestamp: string;
}

export const api = {
  login: (username: string, password: string): Promise<{ token: string; user: Usuario }> =>
    req('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),

  listarEmpresas: (): Promise<Empresa[]> => req('/empresas'),
  criarEmpresa: (payload: NovaEmpresaPayload) => {
    const fd = new FormData();
    fd.append('nome', payload.nome);
    fd.append('descricao', payload.descricao);
    if (payload.endereco) fd.append('endereco', payload.endereco);
    if (payload.latitude != null) fd.append('latitude', String(payload.latitude));
    if (payload.longitude != null) fd.append('longitude', String(payload.longitude));
    if (payload.foto) fd.append('foto', payload.foto);
    return req('/empresas', { method: 'POST', body: fd });
  },

  resumoStatusEmpresas: (): Promise<ResumoStatusEmpresa[]> => req('/empresas/resumo-status'),
  removerEmpresa: (id: number) => req(`/empresas/${id}`, { method: 'DELETE' }),

  listarDispositivos: (empresaId: number): Promise<Dispositivo[]> =>
    req(`/dispositivos/empresa/${empresaId}`),
  historicoDispositivo: (id: number): Promise<StatusEvento[]> =>
    req(`/dispositivos/${id}/historico`),
  metricasDispositivo: (id: number, minutos: number): Promise<PingMetrica[]> =>
    req(`/dispositivos/${id}/metricas?minutos=${minutos}`),
  criarDispositivo: (payload: Partial<Dispositivo>) =>
    req('/dispositivos', { method: 'POST', body: JSON.stringify(payload) }),
  editarDispositivo: (id: number, payload: Partial<Dispositivo>) =>
    req(`/dispositivos/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  removerDispositivo: (id: number) => req(`/dispositivos/${id}`, { method: 'DELETE' }),

  topologiaEmpresa: (
    empresaId: number
  ): Promise<{ nodes: TopoNode[]; edges: TopoEdge[]; viewport: { pos_x: number; pos_y: number; zoom: number } | null }> =>
    req(`/topologia/empresa/${empresaId}`),
  salvarViewportTopologia: (empresaId: number, pos_x: number, pos_y: number, zoom: number) =>
    req(`/topologia/empresa/${empresaId}/viewport`, { method: 'PUT', body: JSON.stringify({ pos_x, pos_y, zoom }) }),
  criarNode: (payload: any) => req('/topologia/nodes', { method: 'POST', body: JSON.stringify(payload) }),
  moverNode: (id: number, pos_x: number, pos_y: number) =>
    req(`/topologia/nodes/${id}/posicao`, { method: 'PUT', body: JSON.stringify({ pos_x, pos_y }) }),
  removerNode: (id: number) => req(`/topologia/nodes/${id}`, { method: 'DELETE' }),
  criarEdge: (payload: any) => req('/topologia/edges', { method: 'POST', body: JSON.stringify(payload) }),
  removerEdge: (id: number) => req(`/topologia/edges/${id}`, { method: 'DELETE' }),

  auditoria: (): Promise<AuditoriaItem[]> => req('/auditoria'),

  listarLinks: (empresaId: number): Promise<LinkDedicado[]> => req(`/links/empresa/${empresaId}`),
  criarLink: (empresa_id: number, bloco: string, descricao: string) =>
    req('/links', { method: 'POST', body: JSON.stringify({ empresa_id, bloco, descricao }) }),
  removerLink: (id: number) => req(`/links/${id}`, { method: 'DELETE' }),

  statusAlertas: (): Promise<{ telegramConfigurado: boolean; tokenDefinido: boolean; chatId: string; atrasoSeg: number }> =>
    req('/alertas/status'),
  salvarConfigAlertas: (payload: { bot_token?: string; chat_id: string; alerta_atraso_seg: number }) =>
    req('/alertas/config', { method: 'POST', body: JSON.stringify(payload) }),
  testarAlertaTelegram: () => req('/alertas/teste', { method: 'POST' }),

  adminOverview: (): Promise<{
    empresas: number;
    usuarios: number;
    links_dedicados: number;
    dispositivos: { total: number; online: number; degradados: number; offline: number };
    servicos: { banco: boolean; telegram: boolean; mcp: boolean };
    uptime_segundos: number;
  }> => req('/admin/overview'),
  acessos: (): Promise<AcessoItem[]> => req('/admin/acessos'),

  statusIntegracao: (): Promise<{ mcpAtivo: boolean; caminho: string }> => req('/integracao/status'),
  gerarChaveMcp: (): Promise<{ chave: string }> => req('/integracao/chave', { method: 'POST' }),
  revogarChaveMcp: () => req('/integracao/chave', { method: 'DELETE' }),

  listarUsuarios: (): Promise<UsuarioListado[]> => req('/usuarios'),
  criarUsuario: (username: string, password: string, role: Papel) =>
    req('/usuarios', { method: 'POST', body: JSON.stringify({ username, password, role }) }),
  removerUsuario: (id: number) => req(`/usuarios/${id}`, { method: 'DELETE' }),
};
