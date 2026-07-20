import { Router } from 'express';
import { pool } from '../db/pool';
import { authMiddleware, requireRole } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { criarUsuarioSchema } from '../validation/schemas';
import { hashPassword } from '../services/authService';
import { registrarAuditoria } from '../services/auditService';

export const usuariosRouter = Router();

usuariosRouter.use(authMiddleware, requireRole('admin'));

usuariosRouter.get('/', async (_req, res) => {
  const [rows] = await pool.query(
    `SELECT id, username, role, ativo, criado_em FROM usuarios ORDER BY username`
  );
  res.json(rows);
});

usuariosRouter.post('/', validateBody(criarUsuarioSchema), async (req, res) => {
  const { username, password, role } = req.body;

  const [existentes]: any = await pool.query(`SELECT id FROM usuarios WHERE username = ?`, [username]);
  if (existentes.length > 0) {
    return res.status(409).json({ erro: 'Já existe um usuário com esse nome' });
  }

  const hash = await hashPassword(password);
  const [result]: any = await pool.query(
    `INSERT INTO usuarios (username, senha_hash, role) VALUES (?, ?, ?)`,
    [username, hash, role]
  );

  await registrarAuditoria(req.user!.username, 'criar', 'usuario', result.insertId, `Criou usuário "${username}" (${role})`);
  res.status(201).json({ id: result.insertId, username, role, ativo: true });
});

usuariosRouter.delete('/:id', async (req, res) => {
  const alvoId = Number(req.params.id);

  if (alvoId === req.user!.id) {
    return res.status(400).json({ erro: 'Você não pode remover sua própria conta' });
  }

  const [alvoRows]: any = await pool.query(`SELECT role, ativo FROM usuarios WHERE id = ?`, [alvoId]);
  const alvo = alvoRows[0];
  if (!alvo) return res.status(404).json({ erro: 'Usuário não encontrado' });

  if (alvo.role === 'admin' && alvo.ativo) {
    const [admins]: any = await pool.query(
      `SELECT COUNT(*) as total FROM usuarios WHERE role = 'admin' AND ativo = TRUE`
    );
    if (admins[0].total <= 1) {
      return res.status(400).json({ erro: 'Não é possível remover o último administrador ativo' });
    }
  }

  await pool.query(`UPDATE usuarios SET ativo = FALSE WHERE id = ?`, [alvoId]);
  await registrarAuditoria(req.user!.username, 'remover', 'usuario', alvoId, 'Desativou usuário');
  res.json({ ok: true });
});
