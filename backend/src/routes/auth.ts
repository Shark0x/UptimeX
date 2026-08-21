import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { pool } from '../db/pool';
import { validateBody } from '../middleware/validate';
import { alterarMinhaSenhaSchema, loginSchema } from '../validation/schemas';
import { hashPassword, verifyPassword } from '../services/authService';
import { registrarAuditoria } from '../services/auditService';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth';
import { uploadAvatarUsuario, validarConteudoFotoEmpresa, descartarUploadFoto } from '../middleware/upload';
import {
  criarSessao,
  definirCookiesSessao,
  limparCookiesSessao,
  revogarSessao,
  revogarSessoesUsuario,
} from '../services/sessionService';
import { withUserContext } from '../db/pool';
import type { Server as SocketServer } from 'socket.io';

let socketIo: SocketServer | null = null;
export function definirSocketAuth(io: SocketServer) {
  socketIo = io;
}

export const authRouter = Router();
const HASH_COMPARACAO_LOGIN = '$2b$12$W5RNYltosellz6HTSmzG1OAvK.kILFEabzpbm6lA0hUioERoUevYy';
authRouter.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Muitas tentativas de login. Tente novamente mais tarde.' },
});

const loginPorUsuarioLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  keyGenerator: (req) => String(req.body?.username || '').trim().toLowerCase().slice(0, 50),
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { erro: 'Muitas tentativas para este usuario. Aguarde antes de tentar novamente.' },
});

authRouter.post('/login', loginLimiter, validateBody(loginSchema), loginPorUsuarioLimiter, async (req, res) => {
  const { username, password } = req.body;

  // auth_obter_usuario (SECURITY DEFINER) localiza a conta sem contexto RLS: o
  // login ocorre antes de existir app.user_id.
  const [rows]: any = await pool.query(`SELECT * FROM auth_obter_usuario(?)`, [username]);
  const usuario = rows[0];
  const senhaValida = await verifyPassword(password, usuario?.senha_hash || HASH_COMPARACAO_LOGIN);

  if (!usuario || !usuario.ativo || !senhaValida) {
    // auth_registrar_login (SECURITY DEFINER) grava a auditoria sem contexto RLS.
    await pool.query(`SELECT auth_registrar_login(?, ?, ?, ?, ?)`, [
      usuario?.id ?? null,
      username,
      'login_falhou',
      'Tentativa de login com credenciais inválidas',
      req.ip ?? null,
    ]);
    return res.status(401).json({ erro: 'Credenciais inválidas' });
  }

  // A sessao precisa nascer sob o contexto do proprio usuario: a policy
  // usuario_sessoes_proprias exige app_user_id() = usuario_id.
  const sessao = await withUserContext(usuario.id, () =>
    criarSessao(usuario.id, Number(usuario.sessao_versao), {
      ip: req.ip,
      userAgent: req.get('user-agent'),
    })
  );
  await pool.query(`SELECT auth_registrar_login(?, ?, ?, ?, ?)`, [
    usuario.id,
    usuario.username,
    'login',
    'Login efetuado',
    req.ip ?? null,
  ]);

  definirCookiesSessao(req, res, sessao);
  res.json({ user: { id: usuario.id, username: usuario.username, role: usuario.role, avatar_url: usuario.avatar_url ?? null } });
});

authRouter.get('/me', optionalAuthMiddleware, (req, res) => {
  res.json({
    user: req.user ? {
      id: req.user!.id,
      username: req.user!.username,
      role: req.user!.role,
      avatar_url: req.user!.avatarUrl ?? null,
    } : null,
  });
});

// Avatar do perfil (upload no servidor, servido por rota autenticada — mesmo
// padrão da foto de empresa).
authRouter.get('/me/avatar', authMiddleware, async (req, res) => {
  const [rows]: any = await pool.query(`SELECT avatar_url FROM usuarios WHERE id = ?`, [req.user!.id]);
  const avatarUrl = rows[0]?.avatar_url;
  if (!avatarUrl) return res.status(404).json({ erro: 'Sem avatar' });
  const nomeArquivo = path.basename(String(avatarUrl));
  if (!nomeArquivo || nomeArquivo === '.' || nomeArquivo === '..') {
    return res.status(404).json({ erro: 'Sem avatar' });
  }
  res.sendFile(nomeArquivo, {
    root: path.resolve(__dirname, '../../uploads/usuarios'),
    dotfiles: 'deny',
    cacheControl: false,
    headers: { 'Cache-Control': 'private, max-age=3600' },
  }, (erro) => {
    if (erro && !res.headersSent) res.status(404).json({ erro: 'Sem avatar' });
  });
});

authRouter.post('/me/avatar', authMiddleware, uploadAvatarUsuario.single('avatar'), validarConteudoFotoEmpresa, async (req, res) => {
  if (!req.file) return res.status(400).json({ erro: 'Envie uma imagem em "avatar".' });
  const novoUrl = `/uploads/usuarios/${req.file.filename}`;
  try {
    const [rows]: any = await pool.query(`SELECT avatar_url FROM usuarios WHERE id = ?`, [req.user!.id]);
    const anterior = rows[0]?.avatar_url;
    // usuarios_admin_write bloqueia auto-update de nao-admin; auth_definir_avatar
    // (SECURITY DEFINER) restringe a mudanca a propria conta (app_user_id()).
    await pool.query(`SELECT auth_definir_avatar(?)`, [novoUrl]);
    // Remove o arquivo antigo (se houver) pra não acumular lixo no disco.
    if (anterior) {
      const nomeAntigo = path.basename(String(anterior));
      if (nomeAntigo && nomeAntigo !== '.' && nomeAntigo !== '..') {
        const fs = await import('fs');
        await fs.promises.unlink(path.resolve(__dirname, '../../uploads/usuarios', nomeAntigo)).catch(() => undefined);
      }
    }
    await registrarAuditoria(req.user!.username, 'editar', 'usuario', req.user!.id, 'Avatar atualizado', req.ip, { usuarioId: req.user!.id });
    res.json({ avatar_url: novoUrl });
  } catch (err: any) {
    await descartarUploadFoto(req);
    res.status(500).json({ erro: err.message || 'Não foi possível salvar o avatar.' });
  }
});

authRouter.post('/logout', authMiddleware, async (req, res) => {
  await revogarSessao(req.user!.sessionId);
  if (req.user!.sessionId) socketIo?.in(`sessao_${req.user!.sessionId}`).disconnectSockets(true);
  limparCookiesSessao(req, res);
  res.status(204).end();
});

authRouter.put('/password', authMiddleware, validateBody(alterarMinhaSenhaSchema), async (req, res) => {
  const [rows]: any = await pool.query(
    `SELECT senha_hash, sessao_versao FROM usuarios WHERE id = ? AND ativo = TRUE LIMIT 1`,
    [req.user!.id]
  );
  const usuario = rows[0];
  if (!usuario || !(await verifyPassword(req.body.senha_atual, usuario.senha_hash))) {
    return res.status(400).json({ erro: 'Senha atual incorreta.' });
  }

  const novoHash = await hashPassword(req.body.nova_senha);
  const novaVersao = Number(usuario.sessao_versao) + 1;
  // auth_alterar_senha (SECURITY DEFINER) altera somente a propria conta
  // (app_user_id()) e apenas colunas seguras — sem tocar em role/ativo.
  await pool.query(`SELECT auth_alterar_senha(?, ?)`, [novoHash, novaVersao]);
  await revogarSessoesUsuario(req.user!.id);
  const sessao = await criarSessao(req.user!.id, novaVersao, {
    ip: req.ip,
    userAgent: req.get('user-agent'),
  });
  definirCookiesSessao(req, res, sessao);
  await registrarAuditoria(
    req.user!.username,
    'senha_alterada',
    'usuario',
    req.user!.id,
    'Alterou a propria senha e revogou as sessoes anteriores',
    req.ip,
    { usuarioId: req.user!.id }
  );
  res.json({ ok: true });
});
