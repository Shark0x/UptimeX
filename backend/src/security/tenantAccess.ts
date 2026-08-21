import { Papel } from '../services/authService';

export interface PrincipalTenant {
  role: Papel;
  empresaIds: number[];
}

export function normalizarIdPositivo(valor: unknown): number | null {
  const id = typeof valor === 'number' ? valor : Number(valor);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function podeAcessarEmpresa(usuario: PrincipalTenant, empresaId: number): boolean {
  return usuario.role === 'admin' || usuario.empresaIds.includes(empresaId);
}

export function podeOperarTenant(usuario: PrincipalTenant): boolean {
  return usuario.role === 'admin' || usuario.role === 'operador';
}

export function filtroEmpresaSql(usuario: PrincipalTenant, coluna: string) {
  if (usuario.role === 'admin') {
    return { sql: '1 = 1', params: [] as unknown[] };
  }

  if (usuario.empresaIds.length === 0) {
    return { sql: '1 = 0', params: [] as unknown[] };
  }

  return { sql: `${coluna} IN (?)`, params: [usuario.empresaIds] as unknown[] };
}
