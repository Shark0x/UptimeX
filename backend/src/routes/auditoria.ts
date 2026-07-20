import { Router } from 'express';
import { pool } from '../db/pool';
import { authMiddleware } from '../middleware/auth';

export const auditoriaRouter = Router();

auditoriaRouter.use(authMiddleware);

auditoriaRouter.get('/', async (req, res) => {
  const limite = Math.min(Number(req.query.limite) || 200, 1000);
  const [rows] = await pool.query(
    `SELECT * FROM auditoria ORDER BY timestamp DESC LIMIT ?`,
    [limite]
  );
  res.json(rows);
});
