import { io } from 'socket.io-client';

// Deriva o backend do host atual: abrindo pelo IP da máquina (ex: celular na
// mesma rede), a API segue junto em vez de apontar pro "localhost" do aparelho.
const HOST_ATUAL = window.location.hostname || 'localhost';
const PROTOCOLO_ATUAL = window.location.protocol === 'https:' ? 'https:' : 'http:';
const API_BASE = import.meta.env.VITE_API_URL || `${PROTOCOLO_ATUAL}//${HOST_ATUAL}:4000/api`;
export const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || `${PROTOCOLO_ATUAL}//${HOST_ATUAL}:4000`;

export const socket = io(SOCKET_URL, { autoConnect: false, withCredentials: true });

// Remove credenciais deixadas por versoes anteriores. A sessao atual vive em
// cookie HttpOnly e, portanto, nao pode ser lida nem roubada pelo JavaScript.
localStorage.removeItem('netmonitor_token');
localStorage.removeItem('netmonitor_user');

export function conectarSocket() {
  if (!socket.connected) socket.connect();
}

export function desconectarSocket() {
  socket.disconnect();
}

function lerCookie(nome: string): string {
  const prefixo = `${encodeURIComponent(nome)}=`;
  const parte = document.cookie.split(';').map((item) => item.trim()).find((item) => item.startsWith(prefixo));
  return parte ? decodeURIComponent(parte.slice(prefixo.length)) : '';
}

/** Busca uma foto tenant pela sessão HttpOnly, sem criar uma URL pública. */
export async function buscarFotoEmpresa(empresaId: number): Promise<Blob | null> {
  const res = await fetch(`${API_BASE}/empresas/${empresaId}/foto`, {
    credentials: 'include',
  });
  if (res.status === 401) {
    window.dispatchEvent(new Event('netmonitor:unauthorized'));
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Erro ao carregar foto: ${res.status}`);
  return res.blob();
}

export async function buscarMeuAvatar(): Promise<Blob | null> {
  const res = await fetch(`${API_BASE}/auth/me/avatar`, { credentials: 'include' });
  if (res.status === 401) window.dispatchEvent(new Event('netmonitor:unauthorized'));
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Erro ao carregar avatar: ${res.status}`);
  return res.blob();
}

async function req(path: string, options: RequestInit = {}) {
  const isFormData = options.body instanceof FormData;
  const headers: Record<string, string> = isFormData ? {} : { 'Content-Type': 'application/json' };
  const method = String(options.method || 'GET').toUpperCase();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const csrf = lerCookie('netmonitor_csrf');
    if (csrf) headers['X-CSRF-Token'] = csrf;
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...options,
      credentials: 'include',
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

export type Papel = 'admin' | 'operador' | 'visualizador';

export interface Usuario {
  id: number;
  username: string;
  role: Papel;
  avatar_url?: string | null;
}

export interface UsuarioListado extends Usuario {
  ativo: boolean;
  criado_em: string;
  empresa_ids: number[];
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
  /** Início da queda ainda aberta mais antiga da empresa (null = nada fora) */
  offline_desde: string | null;
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
  const resposta = await req(`/map/geocode?q=${encodeURIComponent(endereco)}`) as {
    resultado: { latitude: number; longitude: number; rotulo: string } | null;
  };
  return resposta.resultado;
}

export interface Dispositivo {
  id: number;
  empresa_id: number;
  nome: string;
  ip: string;
  fabricante: string;
  metodo_monitoramento: 'snmp' | 'ping' | 'snmp+ping';
  comunidade_snmp_configurada: boolean;
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

export type PingHistoryRange = '24h' | '7d' | '30d' | '90d' | '1y';

export interface PingHistoryPoint {
  timestamp: string;
  avg_latency: number | null;
  min_latency: number | null;
  max_latency: number | null;
  packet_loss_pct: number;
  uptime_pct: number;
  degraded_pct: number;
}

export interface QuedaRelatorio {
  dispositivo: string;
  inicio: string;
  fim: string | null;
  duracao_segundos: number | null;
  em_andamento: boolean;
}

export interface RelatorioEmpresaData {
  empresa: { id: number; nome: string; endereco: string | null };
  periodo: { range: PingHistoryRange; label: string; inicio: string; fim: string; gerado_em: string };
  kpis: {
    disponibilidade_pct: number | null;
    degradado_pct: number | null;
    latencia_media: number | null;
    latencia_p95: number | null;
    latencia_max: number | null;
    perda_media: number | null;
    perda_max: number | null;
    total_quedas: number;
    tempo_total_offline_seg: number;
    mttr_seg: number | null;
    maior_queda_seg: number | null;
    dispositivos_monitorados: number;
  };
  serie: PingHistoryPoint[];
  quedas: QuedaRelatorio[];
  por_dispositivo: Array<{ dispositivo: string; quedas: number; tempo_offline_seg: number }>;
  limiares: { latencia_ms: number; perda_pct: number };
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

/** Configuração dos resumos periódicos enviados ao Telegram */
export interface ConfigResumo {
  diarioAtivo: boolean;
  diarioHora: number;
  semanalAtivo: boolean;
  semanalDia: number; // 0=domingo … 6=sábado
  semanalHora: number;
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
  login: (username: string, password: string): Promise<{ user: Usuario }> =>
    req('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  sessaoAtual: (): Promise<{ user: Usuario | null }> => req('/auth/me'),
  logout: (): Promise<null> => req('/auth/logout', { method: 'POST' }),
  alterarMinhaSenha: (senha_atual: string, nova_senha: string): Promise<{ ok: boolean }> =>
    req('/auth/password', { method: 'PUT', body: JSON.stringify({ senha_atual, nova_senha }) }),
  enviarAvatar: (arquivo: File): Promise<{ avatar_url: string }> => {
    const fd = new FormData();
    fd.append('avatar', arquivo);
    return req('/auth/me/avatar', { method: 'POST', body: fd });
  },

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
  historicoPingDispositivo: (id: number, range: PingHistoryRange): Promise<PingHistoryPoint[]> =>
    req(`/devices/${id}/ping-history?range=${range}`),
  historicoPingEmpresa: (id: number, range: PingHistoryRange): Promise<PingHistoryPoint[]> =>
    req(`/empresas/${id}/ping-history?range=${range}`),
  relatorioEmpresa: (id: number, range: PingHistoryRange): Promise<RelatorioEmpresaData> =>
    req(`/empresas/${id}/relatorio?range=${range}`),
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

  statusAlertas: (): Promise<{
    telegramConfigurado: boolean;
    tokenDefinido: boolean;
    chatId: string;
    atrasoSeg: number;
    resumo: ConfigResumo;
  }> => req('/alertas/status'),
  salvarConfigAlertas: (payload: { bot_token?: string; chat_id: string; alerta_atraso_seg: number }) =>
    req('/alertas/config', { method: 'POST', body: JSON.stringify(payload) }),
  testarAlertaTelegram: () => req('/alertas/teste', { method: 'POST' }),

  salvarConfigResumo: (payload: ConfigResumo): Promise<{ ok: boolean; resumo: ConfigResumo }> =>
    req('/alertas/resumo/config', { method: 'POST', body: JSON.stringify(payload) }),
  enviarResumoAgora: (periodo: 'diario' | 'semanal') =>
    req('/alertas/resumo/enviar', { method: 'POST', body: JSON.stringify({ periodo }) }),

  adminOverview: (): Promise<{
    empresas: number;
    usuarios: number;
    links_dedicados: number;
    dispositivos: { total: number; online: number; degradados: number; offline: number };
    servicos: { banco: boolean; telegram: boolean; mcp: boolean };
    uptime_segundos: number;
  }> => req('/admin/overview'),
  acessos: (): Promise<AcessoItem[]> => req('/admin/acessos'),

  statusIntegracao: (): Promise<{
    mcpAtivo: boolean;
    caminho: string;
    escopo: 'global' | 'empresa' | null;
    empresaId: number | null;
    expiresAt: string | null;
  }> => req('/integracao/status'),
  gerarChaveMcp: (payload: { empresa_id?: number; global: boolean; expires_days?: number }): Promise<{ chave: string }> =>
    req('/integracao/chave', { method: 'POST', body: JSON.stringify(payload) }),
  revogarChaveMcp: () => req('/integracao/chave', { method: 'DELETE' }),

  listarUsuarios: (): Promise<UsuarioListado[]> => req('/usuarios'),
  criarUsuario: (username: string, password: string, role: Papel, empresa_ids: number[] = []) =>
    req('/usuarios', { method: 'POST', body: JSON.stringify({ username, password, role, empresa_ids }) }),
  atualizarUsuario: (id: number, username: string, nova_senha?: string) =>
    req(`/usuarios/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ username, ...(nova_senha ? { nova_senha } : {}) }),
    }),
  atualizarEmpresasUsuario: (id: number, empresa_ids: number[]) =>
    req(`/usuarios/${id}/empresas`, { method: 'PUT', body: JSON.stringify({ empresa_ids }) }),
  removerUsuario: (id: number) => req(`/usuarios/${id}`, { method: 'DELETE' }),
  redefinirSenhaUsuario: (id: number, nova_senha: string) =>
    req(`/usuarios/${id}/password`, { method: 'PUT', body: JSON.stringify({ nova_senha }) }),
};
