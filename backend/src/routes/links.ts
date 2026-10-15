import { Router } from 'express';
import { Server as SocketServer } from 'socket.io';
import { pool } from '../db/pool';
import { registrarAuditoria } from '../services/auditService';
import { authMiddleware, requireEmpresaParam, requireRole } from '../middleware/auth';
import { criarLinkSchema } from '../validation/schemas';
import { normalizarIdPositivo, podeAcessarEmpresa, podeOperarTenant } from '../security/tenantAccess';
import { iniciarMonitoramento, pararMonitoramento } from '../services/monitorEngine';

export function criarLinksRouter(io: SocketServer) {
  const linksRouter = Router();

  linksRouter.use(authMiddleware);

  linksRouter.get('/empresa/:empresaId', requireEmpresaParam('empresaId'), async (req, res) => {
    const empresaId = Number(req.params.empresaId);
    const [empresas]: any = await pool.query(`SELECT id FROM empresas WHERE id = ?`, [empresaId]);
    if (empresas.length === 0) return res.status(404).json({ erro: 'Empresa não encontrada' });
    const [rows] = await pool.query(
      `SELECT * FROM links_dedicados WHERE empresa_id = ? ORDER BY criado_em DESC`,
      [empresaId]
    );
    res.json(rows);
  });

  linksRouter.post('/', async (req, res) => {
    const parsed = criarLinkSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erro: parsed.error.issues[0]?.message ?? 'Dados inválidos' });
    }
    const { empresa_id, bloco, descricao } = parsed.data;
    if (!podeAcessarEmpresa(req.user!, empresa_id)) {
      return res.status(404).json({ erro: 'Empresa não encontrada' });
    }
    if (!podeOperarTenant(req.user!)) {
      return res.status(403).json({ erro: 'Sem permissão para esta ação' });
    }

    const [empresas]: any = await pool.query(`SELECT id FROM empresas WHERE id = ?`, [empresa_id]);
    if (empresas.length === 0) return res.status(404).json({ erro: 'Empresa não encontrada' });
    const [result]: any = await pool.query(
      `INSERT INTO links_dedicados (empresa_id, bloco, descricao) VALUES (?, ?, ?) RETURNING id`,
      [empresa_id, bloco, descricao || null]
    );
    const novoLinkId = Number(result[0].id);
    await registrarAuditoria(
      req.user!.username,
      'criar',
      'link_dedicado',
      novoLinkId,
      'Registrou bloco de enderecos',
      req.ip,
      { usuarioId: req.user!.id, empresaId: empresa_id }
    );
    res.status(201).json({ id: novoLinkId });
  });

  // -------- "Sem monitoramento": flag do link + associação a um dispositivo --------
  // O motor pinga `dispositivos` (WHERE ativo=TRUE), não blocos /30. Para o toggle
  // do link REALMENTE pausar o ping, o operador associa o link a um dispositivo da
  // mesma empresa; aí marcar sem_monitoramento=TRUE pausa (ativo=FALSE) esse device
  // e desmarcar reativa. Sem dispositivo associado, a flag é apenas informativa.
  // Nunca apaga histórico (ping/status/quedas/incidentes) — só alterna `ativo`.
  linksRouter.patch('/:id/monitoramento', async (req, res) => {
    const linkId = normalizarIdPositivo(req.params.id);
    if (!linkId) return res.status(400).json({ erro: 'Link inválido' });

    const semMonitoramento = req.body?.sem_monitoramento;
    if (typeof semMonitoramento !== 'boolean') {
      return res.status(400).json({ erro: 'sem_monitoramento deve ser booleano' });
    }
    // dispositivo_id: número positivo, ou null/ausente para desassociar
    let dispositivoId: number | null = null;
    if (req.body?.dispositivo_id != null) {
      dispositivoId = normalizarIdPositivo(req.body.dispositivo_id);
      if (!dispositivoId) return res.status(400).json({ erro: 'dispositivo_id inválido' });
    }

    const [links]: any = await pool.query(
      `SELECT id, empresa_id, sem_monitoramento, dispositivo_id FROM links_dedicados WHERE id = ?`,
      [linkId]
    );
    if (links.length === 0) return res.status(404).json({ erro: 'Link não encontrado' });
    const link = links[0];
    const empresaId = Number(link.empresa_id);

    if (!podeAcessarEmpresa(req.user!, empresaId)) {
      return res.status(404).json({ erro: 'Link não encontrado' });
    }
    if (!podeOperarTenant(req.user!)) {
      return res.status(403).json({ erro: 'Sem permissão para esta ação' });
    }

    // Se há dispositivo, ele tem de ser da MESMA empresa do link (a FK composta já
    // garante no banco; validamos antes para devolver 400 limpo em vez de erro de FK).
    if (dispositivoId != null) {
      const [devs]: any = await pool.query(
        `SELECT id FROM dispositivos WHERE id = ? AND empresa_id = ?`,
        [dispositivoId, empresaId]
      );
      if (devs.length === 0) {
        return res.status(400).json({ erro: 'Dispositivo não pertence a esta empresa' });
      }
    }

    const antigoDispositivo: number | null =
      link.dispositivo_id != null ? Number(link.dispositivo_id) : null;
    const antigoSem = Boolean(link.sem_monitoramento);

    // Persiste o novo estado do link.
    await pool.query(
      `UPDATE links_dedicados SET sem_monitoramento = ?, dispositivo_id = ? WHERE id = ? AND empresa_id = ?`,
      [semMonitoramento, dispositivoId, linkId, empresaId]
    );

    // Reconciliação do `ativo` dos dispositivos envolvidos:
    //  - Device que estava pausado por ESTE link e deixou de ser o alvo pausado
    //    (troca de device ou destoggle) volta a ser monitorado.
    //  - Novo alvo com sem_monitoramento=TRUE é pausado.
    const alvoPausar = semMonitoramento && dispositivoId != null ? dispositivoId : null;

    if (antigoSem && antigoDispositivo != null && antigoDispositivo !== alvoPausar) {
      await pool.query(`UPDATE dispositivos SET ativo = TRUE WHERE id = ? AND empresa_id = ?`, [
        antigoDispositivo,
        empresaId,
      ]);
      iniciarMonitoramento(antigoDispositivo, io);
    }

    if (alvoPausar != null) {
      await pool.query(`UPDATE dispositivos SET ativo = FALSE WHERE id = ? AND empresa_id = ?`, [
        alvoPausar,
        empresaId,
      ]);
      pararMonitoramento(alvoPausar);
    }

    await registrarAuditoria(
      req.user!.username,
      'editar',
      'link_dedicado',
      linkId,
      semMonitoramento
        ? `Marcou link como sem monitoramento${dispositivoId != null ? ` (pausou dispositivo ${dispositivoId})` : ''}`
        : `Reativou monitoramento do link${antigoDispositivo != null ? ` (retomou dispositivo ${antigoDispositivo})` : ''}`,
      req.ip,
      { usuarioId: req.user!.id, empresaId }
    );

    res.json({ ok: true, sem_monitoramento: semMonitoramento, dispositivo_id: dispositivoId });
  });

  linksRouter.delete('/:id', requireRole('admin'), async (req, res) => {
    const linkId = normalizarIdPositivo(req.params.id);
    if (!linkId) return res.status(400).json({ erro: 'Link inválido' });
    const [links]: any = await pool.query(
      `SELECT id, empresa_id, sem_monitoramento, dispositivo_id FROM links_dedicados WHERE id = ?`,
      [linkId]
    );
    if (links.length === 0) return res.status(404).json({ erro: 'Link não encontrado' });
    const link = links[0];
    const empresaId = Number(link.empresa_id);

    // Se o link pausava um dispositivo, retoma o monitoramento ao removê-lo — não
    // faz sentido deixar um device pausado por um link que deixou de existir.
    if (Boolean(link.sem_monitoramento) && link.dispositivo_id != null) {
      const devId = Number(link.dispositivo_id);
      await pool.query(`UPDATE dispositivos SET ativo = TRUE WHERE id = ? AND empresa_id = ?`, [
        devId,
        empresaId,
      ]);
      iniciarMonitoramento(devId, io);
    }

    await pool.query(`DELETE FROM links_dedicados WHERE id = ? AND empresa_id = ?`, [linkId, empresaId]);
    await registrarAuditoria(
      req.user!.username,
      'remover',
      'link_dedicado',
      linkId,
      'Removeu bloco de IPs',
      req.ip,
      { usuarioId: req.user!.id, empresaId }
    );
    res.json({ ok: true });
  });

  return linksRouter;
}
