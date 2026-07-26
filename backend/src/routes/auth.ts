import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { pool } from '../db/pool';
import { validateBody } from '../middleware/validate';
import { loginSchema } from '../validation/schemas';
import { verifyPassword, issueToken } from '../services/authService';
import { registrarAuditoria } from '../services/auditService';

export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Muitas tentativas de login. Tente novamente mais tarde.' },
});

authRouter.post('/login', loginLimiter, validateBody(loginSchema), async (req, res) => {
  const { username, password } = req.body;

  const [rows]: any = await pool.query(
    `SELECT id, username, senha_hash, role, ativo FROM usuarios WHERE username = ?`,
    [username]
  );
  const usuario = rows[0];

  if (!usuario || !usuario.ativo || !(await verifyPassword(password, usuario.senha_hash))) {
    await registrarAuditoria(username, 'login_falhou', 'usuario', usuario?.id ?? null, 'Tentativa de login com credenciais inválidas', req.ip);
    return res.status(401).json({ erro: 'Credenciais inválidas' });
  }

  const token = issueToken({ id: usuario.id, username: usuario.username, role: usuario.role });
  await registrarAuditoria(usuario.username, 'login', 'usuario', usuario.id, 'Login efetuado', req.ip);

  res.json({ token, user: { id: usuario.id, username: usuario.username, role: usuario.role } });
});
