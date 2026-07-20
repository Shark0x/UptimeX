import { Router } from 'express';
import { pool } from '../db/pool';
import { registrarAuditoria } from '../services/auditService';
import { authMiddleware, requireRole } from '../middleware/auth';

export const topologiaRouter = Router();

topologiaRouter.use(authMiddleware);

// Retorna nós + conexões de uma empresa, já com o status atual do dispositivo (se houver)
topologiaRouter.get('/empresa/:empresaId', async (req, res) => {
  const [nodes]: any = await pool.query(
    `SELECT tn.*, d.status_atual, d.ip
     FROM topologia_nodes tn
     LEFT JOIN dispositivos d ON d.id = tn.dispositivo_id
     WHERE tn.empresa_id = ?`,
    [req.params.empresaId]
  );
  const [edges] = await pool.query(
    `SELECT * FROM topologia_edges WHERE empresa_id = ?`,
    [req.params.empresaId]
  );
  const [vps]: any = await pool.query(
    `SELECT pos_x, pos_y, zoom FROM topologia_viewport WHERE empresa_id = ?`,
    [req.params.empresaId]
  );
  res.json({ nodes, edges, viewport: vps.length > 0 ? vps[0] : null });
});

// Salva o enquadramento (pan/zoom) que o operador deixou no canvas
topologiaRouter.put('/empresa/:empresaId/viewport', requireRole('admin'), async (req, res) => {
  const pos_x = Number(req.body.pos_x);
  const pos_y = Number(req.body.pos_y);
  const zoom = Number(req.body.zoom);
  if (!Number.isFinite(pos_x) || !Number.isFinite(pos_y) || !Number.isFinite(zoom)) {
    return res.status(400).json({ erro: 'Viewport inválido' });
  }
  await pool.query(
    `INSERT INTO topologia_viewport (empresa_id, pos_x, pos_y, zoom) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE pos_x = VALUES(pos_x), pos_y = VALUES(pos_y), zoom = VALUES(zoom)`,
    [req.params.empresaId, pos_x, pos_y, zoom]
  );
  res.json({ ok: true });
});

topologiaRouter.post('/nodes', requireRole('admin'), async (req, res) => {
  const { empresa_id, dispositivo_id, label, tipo, pos_x, pos_y } = req.body;
  const [result]: any = await pool.query(
    `INSERT INTO topologia_nodes (empresa_id, dispositivo_id, label, tipo, pos_x, pos_y)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [empresa_id, dispositivo_id || null, label, tipo || 'outro', pos_x || 0, pos_y || 0]
  );
  await registrarAuditoria(req.user!.username, 'criar', 'topologia_node', result.insertId, `Criou nó "${label}"`);
  res.status(201).json({ id: result.insertId });
});

// Atualiza posição do nó (drag and drop no canvas)
topologiaRouter.put('/nodes/:id/posicao', requireRole('admin'), async (req, res) => {
  const { pos_x, pos_y } = req.body;
  await pool.query(`UPDATE topologia_nodes SET pos_x = ?, pos_y = ? WHERE id = ?`, [pos_x, pos_y, req.params.id]);
  res.json({ ok: true });
});

topologiaRouter.delete('/nodes/:id', requireRole('admin'), async (req, res) => {
  await pool.query(`DELETE FROM topologia_nodes WHERE id = ?`, [req.params.id]);
  await registrarAuditoria(req.user!.username, 'remover', 'topologia_node', Number(req.params.id), 'Removeu nó da topologia');
  res.json({ ok: true });
});

topologiaRouter.post('/edges', requireRole('admin'), async (req, res) => {
  const { empresa_id, node_origem, node_destino, label } = req.body;
  const [result]: any = await pool.query(
    `INSERT INTO topologia_edges (empresa_id, node_origem, node_destino, label) VALUES (?, ?, ?, ?)`,
    [empresa_id, node_origem, node_destino, label || null]
  );
  await registrarAuditoria(req.user!.username, 'criar', 'topologia_edge', result.insertId, 'Criou conexão na topologia');
  res.status(201).json({ id: result.insertId });
});

topologiaRouter.delete('/edges/:id', requireRole('admin'), async (req, res) => {
  await pool.query(`DELETE FROM topologia_edges WHERE id = ?`, [req.params.id]);
  await registrarAuditoria(req.user!.username, 'remover', 'topologia_edge', Number(req.params.id), 'Removeu conexão da topologia');
  res.json({ ok: true });
});
