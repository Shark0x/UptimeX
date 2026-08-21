import { Router } from 'express';
import { pool } from '../db/pool';
import { registrarAuditoria } from '../services/auditService';
import { authMiddleware, requireEmpresaParam, requireRole } from '../middleware/auth';
import { criarLinkSchema } from '../validation/schemas';
import { normalizarIdPositivo, podeAcessarEmpresa, podeOperarTenant } from '../security/tenantAccess';

export const linksRouter = Router();

linksRouter.use(authMiddleware);

linksRouter.get('/empresa/:empresaId', requireEmpresaParam('empresaId'), async (req, res) => {
  const empresaId = Number(req.params.empresaId);
  const [empresas]: any = await pool.query(`SELECT id FROM empresas WHERE id = ?`, [empresaId]);
  if (empresas.length === 0) return res.status(404).json({ erro: 'Empresa não encontrada' });
  const [rows] = await pool.query(
    `SELECT * FROM links_dedicados WHERE empresa_id = ? ORDER BY criado_em DESC`,
    [empresaId]
  );
  res.json(rows);
});

linksRouter.post('/', async (req, res) => {
  const parsed = criarLinkSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ erro: parsed.error.issues[0]?.message ?? 'Dados inválidos' });
  }
  const { empresa_id, bloco, descricao } = parsed.data;
  if (!podeAcessarEmpresa(req.user!, empresa_id)) {
    return res.status(404).json({ erro: 'Empresa não encontrada' });
  }
  if (!podeOperarTenant(req.user!)) {
    return res.status(403).json({ erro: 'Sem permissão para esta ação' });
  }

  const [empresas]: any = await pool.query(`SELECT id FROM empresas WHERE id = ?`, [empresa_id]);
  if (empresas.length === 0) return res.status(404).json({ erro: 'Empresa não encontrada' });
  const [result]: any = await pool.query(
    `INSERT INTO links_dedicados (empresa_id, bloco, descricao) VALUES (?, ?, ?) RETURNING id`,
    [empresa_id, bloco, descricao || null]
  );
  const novoLinkId = Number(result[0].id);
  await registrarAuditoria(
    req.user!.username,
    'criar',
    'link_dedicado',
    novoLinkId,
    'Registrou bloco de enderecos',
    req.ip,
    { usuarioId: req.user!.id, empresaId: empresa_id }
  );
  res.status(201).json({ id: novoLinkId });
});

linksRouter.delete('/:id', requireRole('admin'), async (req, res) => {
  const linkId = normalizarIdPositivo(req.params.id);
  if (!linkId) return res.status(400).json({ erro: 'Link inválido' });
  const [links]: any = await pool.query(
    `SELECT id, empresa_id FROM links_dedicados WHERE id = ?`,
    [linkId]
  );
  if (links.length === 0) return res.status(404).json({ erro: 'Link não encontrado' });
  await pool.query(`DELETE FROM links_dedicados WHERE id = ? AND empresa_id = ?`, [linkId, links[0].empresa_id]);
  await registrarAuditoria(
    req.user!.username,
    'remover',
    'link_dedicado',
    linkId,
    'Removeu bloco de IPs',
    req.ip,
    { usuarioId: req.user!.id, empresaId: Number(links[0].empresa_id) }
  );
  res.json({ ok: true });
});
