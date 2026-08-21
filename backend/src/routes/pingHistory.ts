import { Router } from 'express';
import { pool } from '../db/pool';
import { authMiddleware } from '../middleware/auth';
import { filtroEmpresaSql, normalizarIdPositivo } from '../security/tenantAccess';
import {
  consultarHistoricoPingDispositivo,
  normalizarRangeHistorico,
} from '../services/pingHistoryService';

export const devicesPingHistoryRouter = Router();

devicesPingHistoryRouter.use(authMiddleware);

devicesPingHistoryRouter.get('/:id/ping-history', async (req, res) => {
  const deviceId = normalizarIdPositivo(req.params.id);
  if (!deviceId) return res.status(400).json({ erro: 'Dispositivo invalido' });
  const range = normalizarRangeHistorico(req.query.range);
  if (!range) {
    return res.status(400).json({ erro: 'Periodo invalido. Use 24h, 7d, 30d, 90d ou 1y.' });
  }

  try {
    const escopo = filtroEmpresaSql(req.user!, 'd.empresa_id');
    const [dispositivos]: any = await pool.query(
      `SELECT d.id FROM dispositivos d WHERE d.id = ? AND ${escopo.sql} LIMIT 1`,
      [deviceId, ...escopo.params]
    );
    if (dispositivos.length === 0) {
      return res.status(404).json({ erro: 'Dispositivo nao encontrado' });
    }
    res.json(await consultarHistoricoPingDispositivo(deviceId, range));
  } catch {
    console.error(`Erro ao consultar historico de ping do dispositivo id=${deviceId}.`);
    res.status(500).json({ erro: 'Nao foi possivel consultar o historico de ping.' });
  }
});
