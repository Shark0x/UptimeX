import { Router } from 'express';
import { pool } from '../db/pool';
import { registrarAuditoria } from '../services/auditService';
import { authMiddleware, requireRole } from '../middleware/auth';
import { uploadFotoEmpresa } from '../middleware/upload';
import { criarEmpresaSchema } from '../validation/schemas';

export const empresasRouter = Router();

empresasRouter.use(authMiddleware);

empresasRouter.get('/', async (_req, res) => {
  const [rows] = await pool.query(`SELECT * FROM empresas ORDER BY nome`);
  res.json(rows);
});

// Visão macro: status agregado de cada empresa numa query só (leve pro celular).
// Degradação usa os mesmos limiares do front (150ms / 2% de perda).
empresasRouter.get('/resumo-status', async (_req, res) => {
  const [rows] = await pool.query(`
    SELECT
      e.id,
      e.nome,
      e.foto_url,
      e.endereco,
      COUNT(d.id) AS total,
      SUM(CASE WHEN d.status_atual = 'offline' THEN 1 ELSE 0 END) AS offline,
      SUM(CASE WHEN d.status_atual = 'online'
               AND (d.latencia_ms >= 150 OR d.perda_pct >= 2) THEN 1 ELSE 0 END) AS degradados,
      SUM(CASE WHEN d.status_atual = 'online'
               AND NOT (COALESCE(d.latencia_ms, 0) >= 150 OR COALESCE(d.perda_pct, 0) >= 2) THEN 1 ELSE 0 END) AS online,
      SUM(CASE WHEN d.status_atual = 'desconhecido' THEN 1 ELSE 0 END) AS desconhecidos,
      (SELECT COUNT(*) FROM links_dedicados l WHERE l.empresa_id = e.id) AS links_dedicados,
      -- Desde quando a empresa está fora: início da queda ainda aberta mais antiga.
      -- O Mapa TV usa pra "aposentar" o rótulo do nome após X minutos de queda.
      (SELECT MIN(se.inicio) FROM status_eventos se
        JOIN dispositivos d2 ON d2.id = se.dispositivo_id
        WHERE d2.empresa_id = e.id AND d2.ativo = TRUE
          AND se.status = 'offline' AND se.fim IS NULL) AS offline_desde
    FROM empresas e
    LEFT JOIN dispositivos d ON d.empresa_id = e.id AND d.ativo = TRUE
    GROUP BY e.id, e.nome, e.foto_url, e.endereco
    ORDER BY e.nome
  `);
  res.json(rows);
});

empresasRouter.get('/:id', async (req, res) => {
  const [rows]: any = await pool.query(`SELECT * FROM empresas WHERE id = ?`, [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ erro: 'Empresa não encontrada' });
  res.json(rows[0]);
});

empresasRouter.post('/', requireRole('admin'), uploadFotoEmpresa.single('foto'), async (req, res) => {
  const parsed = criarEmpresaSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ erro: 'Dados inválidos', detalhes: parsed.error.flatten() });
  }
  const { nome, descricao, endereco, latitude, longitude } = parsed.data;
  const foto_url = req.file ? `/uploads/empresas/${req.file.filename}` : null;

  const [result]: any = await pool.query(
    `INSERT INTO empresas (nome, descricao, foto_url, endereco, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?)`,
    [nome, descricao || null, foto_url, endereco || null, latitude ?? null, longitude ?? null]
  );
  await registrarAuditoria(req.user!.username, 'criar', 'empresa', result.insertId, `Criou empresa "${nome}"`);
  res.status(201).json({ id: result.insertId, nome, descricao, foto_url, endereco, latitude, longitude });
});

empresasRouter.put('/:id', requireRole('admin'), uploadFotoEmpresa.single('foto'), async (req, res) => {
  const parsed = criarEmpresaSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ erro: 'Dados inválidos', detalhes: parsed.error.flatten() });
  }
  const { nome, descricao, endereco, latitude, longitude } = parsed.data;
  const geo = [endereco || null, latitude ?? null, longitude ?? null];

  if (req.file) {
    const foto_url = `/uploads/empresas/${req.file.filename}`;
    await pool.query(
      `UPDATE empresas SET nome = ?, descricao = ?, endereco = ?, latitude = ?, longitude = ?, foto_url = ? WHERE id = ?`,
      [nome, descricao || null, ...geo, foto_url, req.params.id]
    );
  } else {
    await pool.query(
      `UPDATE empresas SET nome = ?, descricao = ?, endereco = ?, latitude = ?, longitude = ? WHERE id = ?`,
      [nome, descricao || null, ...geo, req.params.id]
    );
  }

  await registrarAuditoria(req.user!.username, 'editar', 'empresa', Number(req.params.id), `Editou empresa "${nome}"`);
  res.json({ ok: true });
});

empresasRouter.delete('/:id', requireRole('admin'), async (req, res) => {
  await pool.query(`DELETE FROM empresas WHERE id = ?`, [req.params.id]);
  await registrarAuditoria(req.user!.username, 'remover', 'empresa', Number(req.params.id), 'Removeu empresa');
  res.json({ ok: true });
});
