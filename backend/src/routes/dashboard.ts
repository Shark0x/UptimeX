import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { montarDashboard, normalizarRangeDashboard } from '../services/dashboardService';

export const dashboardRouter = Router();

dashboardRouter.use(authMiddleware);

// GET /api/dashboard?range=7d|30d|90d
// Agregado global tenant-safe para a Home: KPIs, quedas por empresa, quedas no
// tempo, ranking de uptime e incidentes recentes. Respeita RLS via req.user.
dashboardRouter.get('/', async (req, res) => {
  const range = normalizarRangeDashboard(req.query.range);
  if (!range) {
    return res.status(400).json({ erro: 'Periodo invalido. Use 7d, 30d ou 90d.' });
  }

  try {
    const dados = await montarDashboard(req.user!, range);
    res.json(dados);
  } catch (err: any) {
    console.error('[dashboard] erro:', err.message, err.code);
    res.status(500).json({ erro: 'Nao foi possivel montar o dashboard.' });
  }
});
