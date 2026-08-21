import crypto from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { CSRF_COOKIE, SESSION_COOKIE, parseCookies } from '../services/sessionService';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function equalConstantTime(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

/** Protecao double-submit para requisicoes autenticadas pelo cookie HttpOnly. */
export function csrfMiddleware(req: Request, res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method)) return next();
  if (req.path === '/auth/login' || req.path === '/mcp') return next();

  const cookies = parseCookies(req.headers.cookie);
  if (!cookies[SESSION_COOKIE]) return next(); // clientes Bearer/API nao usam cookie

  const cookieToken = cookies[CSRF_COOKIE] || '';
  const headerToken = String(req.headers['x-csrf-token'] || '');
  if (!cookieToken || !headerToken || !equalConstantTime(cookieToken, headerToken)) {
    return res.status(403).json({ erro: 'Requisicao bloqueada pela protecao CSRF.' });
  }
  next();
}

