import { Router } from 'express';
import { pool } from '../db/pool';
import { registrarAuditoria } from '../services/auditService';
import { authMiddleware, requireRole } from '../middleware/auth';
import { criarLinkSchema } from '../validation/schemas';

export const linksRouter = Router();

linksRouter.use(authMiddleware);

linksRouter.get('/empresa/:empresaId', async (req, res) => {
  const [rows] = await pool.query(
    `SELECT * FROM links_dedicados WHERE empresa_id = ? ORDER BY criado_em DESC`,
    [req.params.empresaId]
  );
  res.json(rows);
});

linksRouter.post('/', requireRole('admin'), async (req, res) => {
  const parsed = criarLinkSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ erro: parsed.error.issues[0]?.message ?? 'Dados inválidos' });
  }
  const { empresa_id, bloco, descricao } = parsed.data;
  const [result]: any = await pool.query(
    `INSERT INTO links_dedicados (empresa_id, bloco, descricao) VALUES (?, ?, ?)`,
    [empresa_id, bloco, descricao || null]
  );
  await registrarAuditoria(req.user!.username, 'criar', 'link_dedicado', result.insertId, `Registrou bloco ${bloco}`);
  res.status(201).json({ id: result.insertId });
});

linksRouter.delete('/:id', requireRole('admin'), async (req, res) => {
  await pool.query(`DELETE FROM links_dedicados WHERE id = ?`, [req.params.id]);
  await registrarAuditoria(req.user!.username, 'remover', 'link_dedicado', Number(req.params.id), 'Removeu bloco de IPs');
  res.json({ ok: true });
});
