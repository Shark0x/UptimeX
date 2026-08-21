import { Router } from 'express';
import path from 'path';
import { pool } from '../db/pool';
import { registrarAuditoria } from '../services/auditService';
import { authMiddleware, requireRole } from '../middleware/auth';
import { descartarUploadFoto, uploadFotoEmpresa, validarConteudoFotoEmpresa } from '../middleware/upload';
import { criarEmpresaSchema } from '../validation/schemas';
import { filtroEmpresaSql, normalizarIdPositivo, podeAcessarEmpresa } from '../security/tenantAccess';
import { consultarHistoricoPingEmpresa, normalizarRangeHistorico } from '../services/pingHistoryService';

export const empresasRouter = Router();

empresasRouter.use(authMiddleware);

empresasRouter.get('/', async (req, res) => {
  const escopo = filtroEmpresaSql(req.user!, 'e.id');
  const [rows] = await pool.query(
    `SELECT e.* FROM empresas e WHERE ${escopo.sql} ORDER BY e.nome`,
    escopo.params
  );
  res.json(rows);
});

// Visão macro: status agregado de cada empresa numa query só (leve pro celular).
// Degradação usa os mesmos limiares do front (150ms / 2% de perda).
empresasRouter.get('/resumo-status', async (req, res) => {
  const escopo = filtroEmpresaSql(req.user!, 'e.id');
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
    WHERE ${escopo.sql}
    GROUP BY e.id, e.nome, e.foto_url, e.endereco
    ORDER BY e.nome
  `, escopo.params);
  res.json(rows);
});

empresasRouter.get('/:id/ping-history', async (req, res) => {
  const empresaId = normalizarIdPositivo(req.params.id);
  if (!empresaId) return res.status(400).json({ erro: 'Empresa invalida' });
  if (!podeAcessarEmpresa(req.user!, empresaId)) {
    return res.status(404).json({ erro: 'Empresa nao encontrada' });
  }
  const range = normalizarRangeHistorico(req.query.range);
  if (!range) {
    return res.status(400).json({ erro: 'Periodo invalido. Use 24h, 7d, 30d, 90d ou 1y.' });
  }

  try {
    const [empresas]: any = await pool.query(`SELECT id FROM empresas WHERE id = ? LIMIT 1`, [empresaId]);
    if (empresas.length === 0) return res.status(404).json({ erro: 'Empresa nao encontrada' });
    res.json(await consultarHistoricoPingEmpresa(empresaId, range));
  } catch {
    console.error(`Erro ao consultar historico de ping da empresa id=${empresaId}.`);
    res.status(500).json({ erro: 'Nao foi possivel consultar o historico de ping.' });
  }
});

// Fotos são recursos tenant: o arquivo só sai depois da mesma verificação de
// vínculo usada nas demais rotas. path.basename impede travessia de diretório.
empresasRouter.get('/:id/foto', async (req, res) => {
  const empresaId = normalizarIdPositivo(req.params.id);
  if (!empresaId) return res.status(400).json({ erro: 'Empresa inválida' });
  if (!podeAcessarEmpresa(req.user!, empresaId)) {
    return res.status(404).json({ erro: 'Foto não encontrada' });
  }

  const [rows]: any = await pool.query(`SELECT foto_url FROM empresas WHERE id = ?`, [empresaId]);
  const fotoUrl = rows[0]?.foto_url;
  if (!fotoUrl) return res.status(404).json({ erro: 'Foto não encontrada' });
  const nomeArquivo = path.basename(String(fotoUrl));
  if (!nomeArquivo || nomeArquivo === '.' || nomeArquivo === '..') {
    return res.status(404).json({ erro: 'Foto não encontrada' });
  }

  res.sendFile(nomeArquivo, {
    root: path.resolve(__dirname, '../../uploads/empresas'),
    dotfiles: 'deny',
    cacheControl: false,
    headers: { 'Cache-Control': 'private, max-age=3600' },
  }, (erro) => {
    if (erro && !res.headersSent) res.status(404).json({ erro: 'Foto não encontrada' });
  });
});

empresasRouter.get('/:id', async (req, res) => {
  const empresaId = normalizarIdPositivo(req.params.id);
  if (!empresaId) return res.status(400).json({ erro: 'Empresa inválida' });
  if (!podeAcessarEmpresa(req.user!, empresaId)) {
    return res.status(404).json({ erro: 'Empresa não encontrada' });
  }
  const [rows]: any = await pool.query(`SELECT * FROM empresas WHERE id = ?`, [empresaId]);
  if (rows.length === 0) return res.status(404).json({ erro: 'Empresa não encontrada' });
  res.json(rows[0]);
});

empresasRouter.post('/', requireRole('admin'), uploadFotoEmpresa.single('foto'), validarConteudoFotoEmpresa, async (req, res) => {
  const parsed = criarEmpresaSchema.safeParse(req.body);
  if (!parsed.success) {
    await descartarUploadFoto(req);
    return res.status(400).json({ erro: 'Dados inválidos', detalhes: parsed.error.flatten() });
  }
  const { nome, descricao, endereco, latitude, longitude } = parsed.data;
  const foto_url = req.file ? `/uploads/empresas/${req.file.filename}` : null;

  const [result]: any = await pool.query(
    `INSERT INTO empresas (nome, descricao, foto_url, endereco, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
    [nome, descricao || null, foto_url, endereco || null, latitude ?? null, longitude ?? null]
  );
  const novaEmpresaId = Number(result[0].id);
  await registrarAuditoria(
    req.user!.username,
    'criar',
    'empresa',
    novaEmpresaId,
    `Criou empresa "${nome}"`,
    req.ip,
    { usuarioId: req.user!.id, empresaId: novaEmpresaId }
  );
  res.status(201).json({ id: novaEmpresaId, nome, descricao, foto_url, endereco, latitude, longitude });
});

empresasRouter.put('/:id', requireRole('admin'), uploadFotoEmpresa.single('foto'), validarConteudoFotoEmpresa, async (req, res) => {
  const empresaId = normalizarIdPositivo(req.params.id);
  if (!empresaId) return res.status(400).json({ erro: 'Empresa inválida' });
  const [existentes]: any = await pool.query(`SELECT id FROM empresas WHERE id = ?`, [empresaId]);
  if (existentes.length === 0) return res.status(404).json({ erro: 'Empresa não encontrada' });
  const parsed = criarEmpresaSchema.safeParse(req.body);
  if (!parsed.success) {
    await descartarUploadFoto(req);
    return res.status(400).json({ erro: 'Dados inválidos', detalhes: parsed.error.flatten() });
  }
  const { nome, descricao, endereco, latitude, longitude } = parsed.data;
  const geo = [endereco || null, latitude ?? null, longitude ?? null];

  if (req.file) {
    const foto_url = `/uploads/empresas/${req.file.filename}`;
    await pool.query(
      `UPDATE empresas SET nome = ?, descricao = ?, endereco = ?, latitude = ?, longitude = ?, foto_url = ? WHERE id = ?`,
      [nome, descricao || null, ...geo, foto_url, empresaId]
    );
  } else {
    await pool.query(
      `UPDATE empresas SET nome = ?, descricao = ?, endereco = ?, latitude = ?, longitude = ? WHERE id = ?`,
      [nome, descricao || null, ...geo, empresaId]
    );
  }

  await registrarAuditoria(
    req.user!.username,
    'editar',
    'empresa',
    empresaId,
    `Editou empresa "${nome}"`,
    req.ip,
    { usuarioId: req.user!.id, empresaId }
  );
  res.json({ ok: true });
});

empresasRouter.delete('/:id', requireRole('admin'), async (req, res) => {
  const empresaId = normalizarIdPositivo(req.params.id);
  if (!empresaId) return res.status(400).json({ erro: 'Empresa inválida' });
  const [, meta] = await pool.query(`DELETE FROM empresas WHERE id = ?`, [empresaId]);
  if (meta.rowCount === 0) return res.status(404).json({ erro: 'Empresa não encontrada' });
  await registrarAuditoria(
    req.user!.username,
    'remover',
    'empresa',
    empresaId,
    'Removeu empresa',
    req.ip,
    { usuarioId: req.user!.id, empresaId }
  );
  res.json({ ok: true });
});
