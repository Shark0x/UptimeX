import bcrypt from 'bcrypt';

export type Papel = 'admin' | 'operador' | 'visualizador';

export interface UsuarioAutenticado {
  id: number;
  username: string;
  role: Papel;
  sessionVersion: number;
  empresaIds: number[];
  avatarUrl?: string | null;
  tokenExpiresAt?: number;
  sessionId?: number;
}

export function hashPassword(senha: string): Promise<string> {
  return bcrypt.hash(senha, 12);
}

export function verifyPassword(senha: string, hash: string): Promise<boolean> {
  return bcrypt.compare(senha, hash);
}
