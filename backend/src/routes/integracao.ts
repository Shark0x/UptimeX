import { Router } from 'express';
import crypto from 'crypto';
import { authMiddleware, requireRole } from '../middleware/auth';
import { obterConfig, salvarConfig } from '../services/configService';
import { registrarAuditoria } from '../services/auditService';

/**
 * Gerência da integração MCP (chave de API que a IA usa pra conectar).
 * Protegida por login de admin. A chave em si é armazenada em `configuracoes`
 * e nunca é devolvida depois de gerada — só no momento da geração.
 */
export const integracaoRouter = Router();

integracaoRouter.use(authMiddleware);

integracaoRouter.get('/status', (_req, res) => {
  res.json({
    mcpAtivo: obterConfig('mcp_api_key') !== '',
    caminho: '/api/mcp',
  });
});

// Gera (ou regenera) a chave e a devolve UMA vez pra ser copiada
integracaoRouter.post('/chave', requireRole('admin'), async (req, res) => {
  const chave = 'utmx_' + crypto.randomBytes(24).toString('base64url');
  await salvarConfig({ mcp_api_key: chave });
  await registrarAuditoria(req.user!.username, 'editar', 'config', null, 'Gerou chave de integração MCP');
  res.json({ chave });
});

integracaoRouter.delete('/chave', requireRole('admin'), async (req, res) => {
  await salvarConfig({ mcp_api_key: '' });
  await registrarAuditoria(req.user!.username, 'editar', 'config', null, 'Revogou chave de integração MCP');
  res.json({ ok: true });
});
