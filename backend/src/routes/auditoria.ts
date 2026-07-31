import { Router } from 'express';
import { pool } from '../db/pool';
import { authMiddleware } from '../middleware/auth';

export const auditoriaRouter = Router();

auditoriaRouter.use(authMiddleware);

// Histórico de mudanças (criar/editar/remover) — login/login_falhou ficam à
// parte, em /api/admin/acessos, que é o log de acesso/segurança do site.
auditoriaRouter.get('/', async (req, res) => {
  const limite = Math.min(Number(req.query.limite) || 200, 1000);
  const [rows] = await pool.query(
    `SELECT * FROM auditoria WHERE acao NOT IN ('login', 'login_falhou') ORDER BY timestamp DESC LIMIT ?`,
    [limite]
  );
  res.json(rows);
});
