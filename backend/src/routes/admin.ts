import { Router } from 'express';
import { pool } from '../db/pool';
import { authMiddleware, requireRole } from '../middleware/auth';
import { obterConfig } from '../services/configService';
import { telegramConfigurado } from '../services/telegramService';

/**
 * Visão geral do sistema pro painel de administração: números da operação +
 * saúde dos serviços. Só admin.
 */
export const adminRouter = Router();

adminRouter.use(authMiddleware, requireRole('admin'));

adminRouter.get('/overview', async (_req, res) => {
  const [[emp]]: any = await pool.query(`SELECT COUNT(*) AS n FROM empresas`);
  const [[usr]]: any = await pool.query(`SELECT COUNT(*) AS n FROM usuarios WHERE ativo = TRUE`);
  const [[lnk]]: any = await pool.query(`SELECT COUNT(*) AS n FROM links_dedicados`);
  const [disp]: any = await pool.query(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status_atual = 'offline' THEN 1 ELSE 0 END) AS offline,
      SUM(CASE WHEN status_atual = 'online' AND (latencia_ms >= 150 OR perda_pct >= 2) THEN 1 ELSE 0 END) AS degradados,
      SUM(CASE WHEN status_atual = 'online' AND NOT (COALESCE(latencia_ms,0) >= 150 OR COALESCE(perda_pct,0) >= 2) THEN 1 ELSE 0 END) AS online
    FROM dispositivos WHERE ativo = TRUE
  `);
  const d = disp[0] || {};

  res.json({
    empresas: Number(emp.n),
    usuarios: Number(usr.n),
    links_dedicados: Number(lnk.n),
    dispositivos: {
      total: Number(d.total) || 0,
      online: Number(d.online) || 0,
      degradados: Number(d.degradados) || 0,
      offline: Number(d.offline) || 0,
    },
    servicos: {
      banco: true, // se respondeu esta query, o banco está ok
      telegram: telegramConfigurado(),
      mcp: obterConfig('mcp_api_key') !== '',
    },
    uptime_segundos: Math.round(process.uptime()),
  });
});
