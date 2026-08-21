import { Router } from 'express';
import { pool } from '../db/pool';
import { registrarAuditoria } from '../services/auditService';
import { authMiddleware, requireEmpresaParam, requireRole } from '../middleware/auth';
import { filtroEmpresaSql, normalizarIdPositivo, podeAcessarEmpresa, podeOperarTenant } from '../security/tenantAccess';
import { validateBody } from '../middleware/validate';
import {
  criarEdgeTopologiaSchema,
  criarNodeTopologiaSchema,
  moverNodeTopologiaSchema,
  viewportTopologiaSchema,
} from '../validation/schemas';

export const topologiaRouter = Router();

topologiaRouter.use(authMiddleware);

// Retorna nós + conexões de uma empresa, já com o status atual do dispositivo (se houver)
topologiaRouter.get('/empresa/:empresaId', requireEmpresaParam('empresaId'), async (req, res) => {
  const empresaId = Number(req.params.empresaId);
  const [empresas]: any = await pool.query(`SELECT id FROM empresas WHERE id = ?`, [empresaId]);
  if (empresas.length === 0) return res.status(404).json({ erro: 'Empresa não encontrada' });

  const [nodes]: any = await pool.query(
    `SELECT tn.*, d.status_atual, d.ip
     FROM topologia_nodes tn
     LEFT JOIN dispositivos d ON d.id = tn.dispositivo_id AND d.empresa_id = tn.empresa_id
     WHERE tn.empresa_id = ?`,
    [empresaId]
  );
  const [edges] = await pool.query(
    `SELECT * FROM topologia_edges WHERE empresa_id = ?`,
    [empresaId]
  );
  const [vps]: any = await pool.query(
    `SELECT pos_x, pos_y, zoom FROM topologia_viewport WHERE empresa_id = ?`,
    [empresaId]
  );
  res.json({ nodes, edges, viewport: vps.length > 0 ? vps[0] : null });
});

// Salva o enquadramento (pan/zoom) que o operador deixou no canvas
topologiaRouter.put(
  '/empresa/:empresaId/viewport',
  requireEmpresaParam('empresaId', 'admin', 'operador'),
  validateBody(viewportTopologiaSchema),
  async (req, res) => {
    const empresaId = Number(req.params.empresaId);
    const [empresas]: any = await pool.query(`SELECT id FROM empresas WHERE id = ?`, [empresaId]);
    if (empresas.length === 0) return res.status(404).json({ erro: 'Empresa não encontrada' });

    const pos_x = Number(req.body.pos_x);
    const pos_y = Number(req.body.pos_y);
    const zoom = Number(req.body.zoom);
    if (!Number.isFinite(pos_x) || !Number.isFinite(pos_y) || !Number.isFinite(zoom) || zoom <= 0) {
      return res.status(400).json({ erro: 'Viewport inválido' });
    }
    await pool.query(
      `INSERT INTO topologia_viewport (empresa_id, pos_x, pos_y, zoom) VALUES (?, ?, ?, ?)
       ON CONFLICT (empresa_id) DO UPDATE SET pos_x = EXCLUDED.pos_x, pos_y = EXCLUDED.pos_y, zoom = EXCLUDED.zoom`,
      [empresaId, pos_x, pos_y, zoom]
    );
    await registrarAuditoria(
      req.user!.username,
      'editar',
      'topologia_viewport',
      empresaId,
      'Atualizou o enquadramento da topologia',
      req.ip,
      { usuarioId: req.user!.id, empresaId }
    );
    res.json({ ok: true });
  }
);

topologiaRouter.post('/nodes', validateBody(criarNodeTopologiaSchema), async (req, res) => {
  const empresaId = normalizarIdPositivo(req.body.empresa_id);
  if (!empresaId) return res.status(400).json({ erro: 'Empresa inválida' });
  if (!podeAcessarEmpresa(req.user!, empresaId)) {
    return res.status(404).json({ erro: 'Empresa não encontrada' });
  }
  if (!podeOperarTenant(req.user!)) {
    return res.status(403).json({ erro: 'Sem permissão para esta ação' });
  }

  const label = typeof req.body.label === 'string' ? req.body.label.trim() : '';
  const tipo = typeof req.body.tipo === 'string' ? req.body.tipo.trim() : 'outro';
  const pos_x = Number(req.body.pos_x ?? 0);
  const pos_y = Number(req.body.pos_y ?? 0);
  const dispositivoId = req.body.dispositivo_id == null || req.body.dispositivo_id === ''
    ? null
    : normalizarIdPositivo(req.body.dispositivo_id);
  if (!label || label.length > 150 || !tipo || tipo.length > 30 ||
      !Number.isFinite(pos_x) || !Number.isFinite(pos_y) ||
      (req.body.dispositivo_id != null && req.body.dispositivo_id !== '' && !dispositivoId)) {
    return res.status(400).json({ erro: 'Dados do nó inválidos' });
  }

  const [empresas]: any = await pool.query(`SELECT id FROM empresas WHERE id = ?`, [empresaId]);
  if (empresas.length === 0) return res.status(404).json({ erro: 'Empresa não encontrada' });
  if (dispositivoId) {
    const [dispositivos]: any = await pool.query(
      `SELECT id FROM dispositivos WHERE id = ? AND empresa_id = ?`,
      [dispositivoId, empresaId]
    );
    if (dispositivos.length === 0) {
      return res.status(404).json({ erro: 'Dispositivo não encontrado nesta empresa' });
    }
  }

  const [result]: any = await pool.query(
    `INSERT INTO topologia_nodes (empresa_id, dispositivo_id, label, tipo, pos_x, pos_y)
     VALUES (?, ?, ?, ?, ?, ?)
     RETURNING id`,
    [empresaId, dispositivoId, label, tipo, pos_x, pos_y]
  );
  const novoNodeId = Number(result[0].id);
  await registrarAuditoria(
    req.user!.username,
    'criar',
    'topologia_node',
    novoNodeId,
    `Criou nó "${label}"`,
    req.ip,
    { usuarioId: req.user!.id, empresaId }
  );
  res.status(201).json({ id: novoNodeId });
});

// Atualiza posição do nó (drag and drop no canvas)
topologiaRouter.put('/nodes/:id/posicao', validateBody(moverNodeTopologiaSchema), async (req, res) => {
  const nodeId = normalizarIdPositivo(req.params.id);
  if (!nodeId) return res.status(400).json({ erro: 'Nó inválido' });
  const escopo = filtroEmpresaSql(req.user!, 'tn.empresa_id');
  const [nodes]: any = await pool.query(
    `SELECT tn.id, tn.empresa_id FROM topologia_nodes tn WHERE tn.id = ? AND ${escopo.sql}`,
    [nodeId, ...escopo.params]
  );
  if (nodes.length === 0) return res.status(404).json({ erro: 'Nó não encontrado' });
  if (!podeOperarTenant(req.user!)) {
    return res.status(403).json({ erro: 'Sem permissão para esta ação' });
  }

  const pos_x = Number(req.body.pos_x);
  const pos_y = Number(req.body.pos_y);
  if (!Number.isFinite(pos_x) || !Number.isFinite(pos_y)) {
    return res.status(400).json({ erro: 'Posição inválida' });
  }
  await pool.query(
    `UPDATE topologia_nodes SET pos_x = ?, pos_y = ? WHERE id = ? AND empresa_id = ?`,
    [pos_x, pos_y, nodeId, nodes[0].empresa_id]
  );
  await registrarAuditoria(
    req.user!.username,
    'editar',
    'topologia_node',
    nodeId,
    'Moveu nó da topologia',
    req.ip,
    { usuarioId: req.user!.id, empresaId: Number(nodes[0].empresa_id) }
  );
  res.json({ ok: true });
});

topologiaRouter.delete('/nodes/:id', requireRole('admin'), async (req, res) => {
  const nodeId = normalizarIdPositivo(req.params.id);
  if (!nodeId) return res.status(400).json({ erro: 'Nó inválido' });
  const [nodes]: any = await pool.query(
    `SELECT id, empresa_id FROM topologia_nodes WHERE id = ?`,
    [nodeId]
  );
  if (nodes.length === 0) return res.status(404).json({ erro: 'Nó não encontrado' });
  await pool.query(`DELETE FROM topologia_nodes WHERE id = ? AND empresa_id = ?`, [nodeId, nodes[0].empresa_id]);
  await registrarAuditoria(
    req.user!.username,
    'remover',
    'topologia_node',
    nodeId,
    'Removeu nó da topologia',
    req.ip,
    { usuarioId: req.user!.id, empresaId: Number(nodes[0].empresa_id) }
  );
  res.json({ ok: true });
});

topologiaRouter.post('/edges', validateBody(criarEdgeTopologiaSchema), async (req, res) => {
  const empresaId = normalizarIdPositivo(req.body.empresa_id);
  if (!empresaId) return res.status(400).json({ erro: 'Empresa inválida' });
  if (!podeAcessarEmpresa(req.user!, empresaId)) {
    return res.status(404).json({ erro: 'Empresa não encontrada' });
  }
  if (!podeOperarTenant(req.user!)) {
    return res.status(403).json({ erro: 'Sem permissão para esta ação' });
  }

  const origemId = normalizarIdPositivo(req.body.node_origem);
  const destinoId = normalizarIdPositivo(req.body.node_destino);
  const label = req.body.label == null ? null : String(req.body.label).trim();
  if (!origemId || !destinoId || origemId === destinoId || (label?.length ?? 0) > 100) {
    return res.status(400).json({ erro: 'Conexão inválida' });
  }

  const [nodes]: any = await pool.query(
    `SELECT id FROM topologia_nodes WHERE empresa_id = ? AND id IN (?, ?)`,
    [empresaId, origemId, destinoId]
  );
  if (nodes.length !== 2) {
    return res.status(404).json({ erro: 'Origem ou destino não pertence a esta empresa' });
  }

  const [result]: any = await pool.query(
    `INSERT INTO topologia_edges (empresa_id, node_origem, node_destino, label) VALUES (?, ?, ?, ?) RETURNING id`,
    [empresaId, origemId, destinoId, label || null]
  );
  const novoEdgeId = Number(result[0].id);
  await registrarAuditoria(
    req.user!.username,
    'criar',
    'topologia_edge',
    novoEdgeId,
    'Criou conexão na topologia',
    req.ip,
    { usuarioId: req.user!.id, empresaId }
  );
  res.status(201).json({ id: novoEdgeId });
});

topologiaRouter.delete('/edges/:id', requireRole('admin'), async (req, res) => {
  const edgeId = normalizarIdPositivo(req.params.id);
  if (!edgeId) return res.status(400).json({ erro: 'Conexão inválida' });
  const [edges]: any = await pool.query(
    `SELECT id, empresa_id FROM topologia_edges WHERE id = ?`,
    [edgeId]
  );
  if (edges.length === 0) return res.status(404).json({ erro: 'Conexão não encontrada' });
  await pool.query(`DELETE FROM topologia_edges WHERE id = ? AND empresa_id = ?`, [edgeId, edges[0].empresa_id]);
  await registrarAuditoria(
    req.user!.username,
    'remover',
    'topologia_edge',
    edgeId,
    'Removeu conexão da topologia',
    req.ip,
    { usuarioId: req.user!.id, empresaId: Number(edges[0].empresa_id) }
  );
  res.json({ ok: true });
});
