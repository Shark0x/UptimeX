import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

export type Papel = 'admin' | 'visualizador';

export interface TokenPayload {
  id: number;
  username: string;
  role: Papel;
}

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET não configurado no .env');
  }
  return secret;
}

export function hashPassword(senha: string): Promise<string> {
  return bcrypt.hash(senha, 12);
}

export function verifyPassword(senha: string, hash: string): Promise<boolean> {
  return bcrypt.compare(senha, hash);
}

export function issueToken(payload: TokenPayload): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: '12h' });
}

export function verifyToken(token: string): TokenPayload {
  return jwt.verify(token, getJwtSecret()) as TokenPayload;
}
