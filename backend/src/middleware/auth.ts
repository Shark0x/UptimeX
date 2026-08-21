import { NextFunction, Request, Response } from 'express';
import { pool, comContextoRls } from '../db/pool';
import { podeAcessarEmpresa } from '../security/tenantAccess';
import type { Papel, UsuarioAutenticado } from '../services/authService';
import { carregarSessao, tokenSessaoDaRequisicao } from '../services/sessionService';

export async function carregarUsuarioAutenticado(token: string): Promise<UsuarioAutenticado> {
  return carregarSessao(token);
}

/** Reconsulta o vinculo no evento do socket; nao confia no estado do handshake.
 *  auth_pode_acessar_empresa e SECURITY DEFINER: o handshake do socket nao tem
 *  contexto RLS (app.user_id), entao a funcao resolve o vinculo por conta propria. */
export async function usuarioPodeAcessarEmpresaAtual(usuarioId: number, empresaId: number): Promise<boolean> {
  const [rows]: any = await pool.query(
    `SELECT auth_pode_acessar_empresa(?, ?) AS ok`,
    [usuarioId, empresaId]
  );
  return Boolean(rows[0]?.ok);
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const cookieToken = tokenSessaoDaRequisicao(req);
  const bearerToken = header?.startsWith('Bearer ') ? header.slice(7).trim() : null;
  const token = cookieToken || bearerToken;
  if (!token) return res.status(401).json({ erro: 'Nao autenticado' });
  try {
    req.user = await carregarUsuarioAutenticado(token);
    req.authSource = cookieToken ? 'cookie' : 'bearer';
  } catch {
    return res.status(401).json({ erro: 'Sessao invalida ou expirada' });
  }
  // A partir daqui a requisicao roda numa transacao com app.user_id definido;
  // toda pool.query do handler herda o contexto RLS. Erros de infra (conexao/BEGIN)
  // propagam via next(err) — nao viram 401.
  return comContextoRls(req.user.id, req, res, next);
}

export async function optionalAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const cookieToken = tokenSessaoDaRequisicao(req);
  const bearerToken = header?.startsWith('Bearer ') ? header.slice(7).trim() : null;
  const token = cookieToken || bearerToken;
  if (!token) return next();
  try {
    req.user = await carregarUsuarioAutenticado(token);
    req.authSource = cookieToken ? 'cookie' : 'bearer';
  } catch {
    req.user = undefined;
  }
  // So abre o contexto RLS quando ha usuario; anonimo segue sem transacao (as
  // policies fecham por padrao com app_user_id() NULL, que e o comportamento certo).
  if (req.user) return comContextoRls(req.user.id, req, res, next);
  return next();
}

export function requireRole(...papeis: Papel[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !papeis.includes(req.user.role)) {
      return res.status(403).json({ erro: 'Sem permissao para esta acao' });
    }
    next();
  };
}

export function requireEmpresaParam(parametro: string, ...papeis: Papel[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const empresaId = Number(req.params[parametro]);
    if (!Number.isInteger(empresaId) || empresaId <= 0) {
      return res.status(400).json({ erro: 'Empresa invalida' });
    }
    if (!req.user || !podeAcessarEmpresa(req.user, empresaId)) {
      return res.status(404).json({ erro: 'Recurso nao encontrado' });
    }
    if (papeis.length > 0 && !papeis.includes(req.user.role)) {
      return res.status(403).json({ erro: 'Sem permissao para esta acao' });
    }
    next();
  };
}
