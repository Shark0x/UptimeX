import { Router } from 'express';
import { pool } from '../db/pool';
import { authMiddleware } from '../middleware/auth';
import { filtroEmpresaSql, normalizarIdPositivo, podeAcessarEmpresa } from '../security/tenantAccess';

export const auditoriaRouter = Router();

auditoriaRouter.use(authMiddleware);

// Histórico de mudanças tenant. Login/login_falhou ficam em /api/admin/acessos.
auditoriaRouter.get('/', async (req, res) => {
  const limite = Math.min(Math.max(Number(req.query.limite) || 200, 1), 1000);
  const empresaSolicitada = req.query.empresaId == null
    ? null
    : normalizarIdPositivo(req.query.empresaId);
  if (req.query.empresaId != null && !empresaSolicitada) {
    return res.status(400).json({ erro: 'Empresa inválida' });
  }
  if (empresaSolicitada && !podeAcessarEmpresa(req.user!, empresaSolicitada)) {
    return res.status(404).json({ erro: 'Empresa não encontrada' });
  }

  const escopo = filtroEmpresaSql(req.user!, 'empresa_id');
  const filtroSolicitado = empresaSolicitada ? 'AND empresa_id = ?' : '';
  const params = [
    ...escopo.params,
    ...(empresaSolicitada ? [empresaSolicitada] : []),
    limite,
  ];
  const [rows] = await pool.query(
    `SELECT id, usuario, acao, entidade, entidade_id, detalhes, "timestamp" FROM auditoria
     WHERE acao NOT IN ('login', 'login_falhou')
       AND ${escopo.sql} ${filtroSolicitado}
     ORDER BY "timestamp" DESC LIMIT ?`,
    params
  );
  res.json(rows);
});
