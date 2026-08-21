import { Router } from 'express';
import { pool } from '../db/pool';
import { authMiddleware, requireRole } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { registrarAuditoria } from '../services/auditService';
import { criarChaveMcp, revogarChavesMcp, statusChavesMcp } from '../services/mcpKeyService';
import { gerarChaveMcpSchema } from '../validation/schemas';

export const integracaoRouter = Router();
integracaoRouter.use(authMiddleware, requireRole('admin'));

integracaoRouter.get('/status', async (_req, res) => {
  const status = await statusChavesMcp();
  res.json({
    mcpAtivo: status.ativas > 0,
    caminho: '/api/mcp',
    escopo: status.global ? 'global' : status.empresaId ? 'empresa' : null,
    empresaId: status.empresaId,
    expiresAt: status.expiresAt,
  });
});

integracaoRouter.post('/chave', validateBody(gerarChaveMcpSchema), async (req, res) => {
  const { empresa_id, global, expires_days } = req.body;
  if (!global) {
    const [empresas]: any = await pool.query(`SELECT id FROM empresas WHERE id = ? LIMIT 1`, [empresa_id]);
    if (empresas.length === 0) return res.status(400).json({ erro: 'Empresa invalida.' });
  }
  const chave = await criarChaveMcp({
    empresaId: empresa_id,
    global,
    expiresDays: expires_days,
    criadaPor: req.user!.id,
  });
  await registrarAuditoria(
    req.user!.username,
    'editar',
    'config',
    null,
    global ? 'Gerou chave MCP global' : `Gerou chave MCP para empresa #${empresa_id}`,
    req.ip,
    { usuarioId: req.user!.id, empresaId: global ? undefined : Number(empresa_id) }
  );
  res.json({ chave });
});

integracaoRouter.delete('/chave', async (req, res) => {
  await revogarChavesMcp();
  await registrarAuditoria(
    req.user!.username,
    'editar',
    'config',
    null,
    'Revogou chaves de integracao MCP',
    req.ip,
    { usuarioId: req.user!.id }
  );
  res.json({ ok: true });
});
