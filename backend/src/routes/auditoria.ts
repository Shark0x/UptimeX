import { Router } from 'express';
import { pool } from '../db/pool';
import { authMiddleware, requireRole } from '../middleware/auth';

export const auditoriaRouter = Router();

// Contém IP e localização de quem acessou o sistema — informação sensível de
// segurança, restrita a admin (mesmo padrão de usuarios/admin routers).
auditoriaRouter.use(authMiddleware, requireRole('admin'));

auditoriaRouter.get('/', async (req, res) => {
  const limite = Math.min(Number(req.query.limite) || 200, 1000);
  const [rows] = await pool.query(
    `SELECT * FROM auditoria ORDER BY timestamp DESC LIMIT ?`,
    [limite]
  );
  res.json(rows);
});
