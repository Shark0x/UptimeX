import { Papel } from '../services/authService';

export interface PrincipalTenant {
  role: Papel;
  empresaIds: number[];
}

// Papéis internos da operação (staff da Tríade) enxergam TODAS as empresas. O
// escopo por empresaIds fica reservado pra um eventual acesso por cliente no futuro.
const PAPEIS_GLOBAIS: Papel[] = ['admin', 'operador', 'visualizador'];

export function enxergaTodasEmpresas(usuario: PrincipalTenant): boolean {
  return PAPEIS_GLOBAIS.includes(usuario.role);
}

export function normalizarIdPositivo(valor: unknown): number | null {
  const id = typeof valor === 'number' ? valor : Number(valor);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function podeAcessarEmpresa(usuario: PrincipalTenant, empresaId: number): boolean {
  return enxergaTodasEmpresas(usuario) || usuario.empresaIds.includes(empresaId);
}

export function podeOperarTenant(usuario: PrincipalTenant): boolean {
  // Visualizador continua somente-leitura: enxerga tudo, mas não opera.
  return usuario.role === 'admin' || usuario.role === 'operador';
}

export function filtroEmpresaSql(usuario: PrincipalTenant, coluna: string) {
  if (enxergaTodasEmpresas(usuario)) {
    return { sql: '1 = 1', params: [] as unknown[] };
  }

  if (usuario.empresaIds.length === 0) {
    return { sql: '1 = 0', params: [] as unknown[] };
  }

  return { sql: `${coluna} IN (?)`, params: [usuario.empresaIds] as unknown[] };
}
