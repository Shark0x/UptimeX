import crypto from 'crypto';
import { Request, Response } from 'express';
import { pool } from '../db/pool';
import type { Papel, UsuarioAutenticado } from './authService';

export const SESSION_COOKIE = 'netmonitor_session';
export const CSRF_COOKIE = 'netmonitor_csrf';

const SESSION_PREFIX = 'utmx_sess_';
const DEFAULT_SESSION_HOURS = 12;
const MAX_SESSION_HOURS = 24 * 30;

function sessionHours(): number {
  const configured = Number(process.env.SESSION_TTL_HOURS || DEFAULT_SESSION_HOURS);
  if (!Number.isFinite(configured)) return DEFAULT_SESSION_HOURS;
  return Math.min(Math.max(Math.trunc(configured), 1), MAX_SESSION_HOURS);
}

function cookieSecure(req: Request): boolean {
  const valor = String(process.env.COOKIE_SECURE || 'auto').toLowerCase();
  if (valor === 'true') return true;
  if (valor === 'false') return false;
  // req.secure só considera X-Forwarded-Proto quando o Express confia no proxy;
  // nunca aceite esse header diretamente de um cliente.
  return req.secure;
}

function cookieSameSite(): 'lax' | 'strict' | 'none' {
  const value = String(process.env.COOKIE_SAME_SITE || 'lax').toLowerCase();
  if (value === 'strict' || value === 'none') return value;
  return 'lax';
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of (header || '').split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    const key = part.slice(0, separator).trim();
    const raw = part.slice(separator + 1).trim();
    if (!key) continue;
    try {
      cookies[key] = decodeURIComponent(raw);
    } catch {
      cookies[key] = raw;
    }
  }
  return cookies;
}

export function tokenHash(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export interface NovaSessao {
  token: string;
  csrfToken: string;
  expiresAt: Date;
  sessionId: number;
}

export async function criarSessao(
  usuarioId: number,
  sessionVersion: number,
  metadata: { ip?: string | null; userAgent?: string | null } = {}
): Promise<NovaSessao> {
  const token = SESSION_PREFIX + crypto.randomBytes(32).toString('base64url');
  const csrfToken = crypto.randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + sessionHours() * 60 * 60 * 1000);

  const [result]: any = await pool.query(
    `INSERT INTO usuario_sessoes
      (usuario_id, token_hash, sessao_versao, expires_at, ip_origem, user_agent)
     VALUES (?, ?, ?, ?, ?, ?)
     RETURNING id`,
    [
      usuarioId,
      tokenHash(token),
      sessionVersion,
      expiresAt,
      metadata.ip?.slice(0, 45) || null,
      metadata.userAgent?.slice(0, 255) || null,
    ]
  );

  // Mantem no maximo dez sessoes ativas por conta e remove material expirado.
  await pool.query(
    `UPDATE usuario_sessoes
     SET revoked_at = COALESCE(revoked_at, NOW())
     WHERE usuario_id = ? AND id NOT IN (
       SELECT id FROM (
         SELECT id FROM usuario_sessoes
         WHERE usuario_id = ? AND revoked_at IS NULL AND expires_at > NOW()
         ORDER BY criado_em DESC LIMIT 10
       ) sessoes_recentes
     ) AND revoked_at IS NULL`,
    [usuarioId, usuarioId]
  );

  return { token, csrfToken, expiresAt, sessionId: Number(result[0].id) };
}

export async function carregarSessao(token: string): Promise<UsuarioAutenticado> {
  if (!token.startsWith(SESSION_PREFIX) || token.length > 200) {
    throw new Error('Sessao invalida');
  }

  // auth_carregar_sessao (SECURITY DEFINER) resolve sessao+usuario+empresas antes
  // de existir contexto RLS e ja atualiza last_used_at de forma throttled.
  const [rows]: any = await pool.query(`SELECT * FROM auth_carregar_sessao(?)`, [tokenHash(token)]);
  const s = rows[0];
  if (!s) throw new Error('Sessao revogada');

  return {
    id: Number(s.usuario_id),
    username: String(s.username),
    role: s.role as Papel,
    sessionVersion: Number(s.sessao_versao),
    empresaIds: Array.isArray(s.empresa_ids) ? s.empresa_ids.map((v: any) => Number(v)) : [],
    avatarUrl: s.avatar_url ?? null,
    tokenExpiresAt: Math.floor(new Date(s.expires_at).getTime() / 1000),
    sessionId: Number(s.session_id),
  };
}

export async function revogarSessao(sessionId: number | undefined): Promise<void> {
  if (!sessionId) return;
  await pool.query(`UPDATE usuario_sessoes SET revoked_at = COALESCE(revoked_at, NOW()) WHERE id = ?`, [sessionId]);
}

export async function revogarSessoesUsuario(usuarioId: number): Promise<void> {
  await pool.query(
    `UPDATE usuario_sessoes SET revoked_at = COALESCE(revoked_at, NOW())
     WHERE usuario_id = ? AND revoked_at IS NULL`,
    [usuarioId]
  );
}

export function definirCookiesSessao(req: Request, res: Response, sessao: NovaSessao): void {
  const common = {
    secure: cookieSecure(req),
    sameSite: cookieSameSite(),
    path: '/',
    expires: sessao.expiresAt,
  } as const;
  res.cookie(SESSION_COOKIE, sessao.token, { ...common, httpOnly: true });
  res.cookie(CSRF_COOKIE, sessao.csrfToken, { ...common, httpOnly: false });
}

export function limparCookiesSessao(req: Request, res: Response): void {
  const common = {
    secure: cookieSecure(req),
    sameSite: cookieSameSite(),
    path: '/',
  } as const;
  res.clearCookie(SESSION_COOKIE, { ...common, httpOnly: true });
  res.clearCookie(CSRF_COOKIE, { ...common, httpOnly: false });
}

export function tokenSessaoDaRequisicao(req: Request): string | null {
  return parseCookies(req.headers.cookie)[SESSION_COOKIE] || null;
}
