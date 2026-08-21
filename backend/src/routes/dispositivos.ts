import { Router } from 'express';
import { Server as SocketServer } from 'socket.io';
import { pool } from '../db/pool';
import { registrarAuditoria } from '../services/auditService';
import { iniciarMonitoramento, pararMonitoramento } from '../services/monitorEngine';
import { limparAlertas } from '../services/alertaService';
import { authMiddleware, requireEmpresaParam, requireRole } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { criarDispositivoSchema, editarDispositivoSchema } from '../validation/schemas';
import { filtroEmpresaSql, normalizarIdPositivo, podeAcessarEmpresa, podeOperarTenant } from '../security/tenantAccess';
import { criptografarSegredo } from '../security/secretCrypto';

export function criarDispositivosRouter(io: SocketServer) {
  const router = Router();

  router.use(authMiddleware);

  router.get('/empresa/:empresaId', requireEmpresaParam('empresaId'), async (req, res) => {
    const [empresas]: any = await pool.query(`SELECT id FROM empresas WHERE id = ?`, [req.params.empresaId]);
    if (empresas.length === 0) return res.status(404).json({ erro: 'Empresa não encontrada' });
    const [rows] = await pool.query(
      `SELECT id, empresa_id, nome, ip, fabricante, metodo_monitoramento,
              porta_snmp, intervalo_polling_seg, status_atual, ultima_verificacao,
              latencia_ms, perda_pct, ativo, criado_em,
              (comunidade_snmp IS NOT NULL AND comunidade_snmp <> '') AS comunidade_snmp_configurada
       FROM dispositivos WHERE empresa_id = ? ORDER BY nome`,
      [req.params.empresaId]
    );
    res.json(rows);
  });

  router.get('/:id/historico', async (req, res) => {
    const dispositivoId = normalizarIdPositivo(req.params.id);
    if (!dispositivoId) return res.status(400).json({ erro: 'Dispositivo inválido' });
    const limite = Math.min(Math.max(Number(req.query.limite) || 100, 1), 1000);
    const escopo = filtroEmpresaSql(req.user!, 'd.empresa_id');
    const [rows]: any = await pool.query(
      `SELECT se.*
       FROM status_eventos se
       JOIN dispositivos d ON d.id = se.dispositivo_id
       WHERE se.dispositivo_id = ? AND ${escopo.sql}
       ORDER BY se.inicio DESC LIMIT ?`,
      [dispositivoId, ...escopo.params, limite]
    );
    if (rows.length === 0) {
      const [dispositivo]: any = await pool.query(
        `SELECT d.id FROM dispositivos d WHERE d.id = ? AND ${escopo.sql}`,
        [dispositivoId, ...escopo.params]
      );
      if (dispositivo.length === 0) return res.status(404).json({ erro: 'Dispositivo não encontrado' });
    }
    res.json(rows);
  });

  // Amostras de latência/perda pros gráficos do drawer. Janelas longas são agregadas
  // em baldes de 5 min pra resposta não passar de alguns milhares de pontos.
  router.get('/:id/metricas', async (req, res) => {
    const dispositivoId = normalizarIdPositivo(req.params.id);
    if (!dispositivoId) return res.status(400).json({ erro: 'Dispositivo inválido' });
    const minutos = Math.min(Math.max(Number(req.query.minutos) || 60, 5), 60 * 24 * 7);
    const escopo = filtroEmpresaSql(req.user!, 'd.empresa_id');

    const [dispositivo]: any = await pool.query(
      `SELECT d.id FROM dispositivos d WHERE d.id = ? AND ${escopo.sql}`,
      [dispositivoId, ...escopo.params]
    );
    if (dispositivo.length === 0) return res.status(404).json({ erro: 'Dispositivo não encontrado' });

    if (minutos > 360) {
      const [rows] = await pool.query(
        `SELECT to_timestamp(floor(extract(epoch from pm."timestamp") / 300) * 300) AT TIME ZONE 'UTC' AS "timestamp",
                AVG(pm.latency_ms) AS latencia_ms,
                MAX(pm.packet_loss) AS perda_pct
         FROM ping_log pm
         JOIN dispositivos d ON d.id = pm.device_id
         WHERE pm.device_id = ? AND ${escopo.sql}
           AND pm."timestamp" >= NOW() - (? * INTERVAL '1 minute')
         GROUP BY 1 ORDER BY 1 ASC`,
        [dispositivoId, ...escopo.params, minutos]
      );
      return res.json(rows);
    }

    const [rows] = await pool.query(
      `SELECT pm.latency_ms AS latencia_ms, pm.packet_loss AS perda_pct, pm."timestamp"
       FROM ping_log pm
       JOIN dispositivos d ON d.id = pm.device_id
       WHERE pm.device_id = ? AND ${escopo.sql}
         AND pm."timestamp" >= NOW() - (? * INTERVAL '1 minute')
       ORDER BY pm."timestamp" ASC`,
      [dispositivoId, ...escopo.params, minutos]
    );
    res.json(rows);
  });

  router.post('/', validateBody(criarDispositivoSchema), async (req, res) => {
    const {
      empresa_id, nome, ip, fabricante, metodo_monitoramento,
      comunidade_snmp, porta_snmp, intervalo_polling_seg,
    } = req.body;
    const empresaId = normalizarIdPositivo(empresa_id)!;
    if (!podeAcessarEmpresa(req.user!, empresaId)) {
      return res.status(404).json({ erro: 'Empresa não encontrada' });
    }
    if (!podeOperarTenant(req.user!)) {
      return res.status(403).json({ erro: 'Sem permissão para esta ação' });
    }

    const [empresas]: any = await pool.query(`SELECT id FROM empresas WHERE id = ?`, [empresaId]);
    if (empresas.length === 0) return res.status(404).json({ erro: 'Empresa não encontrada' });

    const metodo = metodo_monitoramento || 'snmp+ping';
    if (metodo !== 'ping' && !comunidade_snmp?.trim()) {
      return res.status(400).json({ erro: 'Informe a comunidade SNMP para este metodo de monitoramento.' });
    }

    const [result]: any = await pool.query(
      `INSERT INTO dispositivos
        (empresa_id, nome, ip, fabricante, metodo_monitoramento, comunidade_snmp, porta_snmp, intervalo_polling_seg)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
      [
        empresaId, nome, ip,
        fabricante || 'generico',
        metodo,
        comunidade_snmp?.trim() ? criptografarSegredo(comunidade_snmp.trim()) : null,
        porta_snmp || 161,
        intervalo_polling_seg || 30,
      ]
    );

    const novoId = Number(result[0].id);
    iniciarMonitoramento(novoId, io);
    await registrarAuditoria(
      req.user!.username,
      'criar',
      'dispositivo',
      novoId,
      `Criou dispositivo "${nome}"`,
      req.ip,
      { usuarioId: req.user!.id, empresaId }
    );
    res.status(201).json({ id: novoId });
  });

  router.put('/:id', validateBody(editarDispositivoSchema), async (req, res) => {
    const dispositivoId = normalizarIdPositivo(req.params.id);
    if (!dispositivoId) return res.status(400).json({ erro: 'Dispositivo inválido' });
    const escopo = filtroEmpresaSql(req.user!, 'd.empresa_id');
    const [dispositivos]: any = await pool.query(
      `SELECT d.id, d.empresa_id, d.comunidade_snmp FROM dispositivos d WHERE d.id = ? AND ${escopo.sql}`,
      [dispositivoId, ...escopo.params]
    );
    if (dispositivos.length === 0) return res.status(404).json({ erro: 'Dispositivo não encontrado' });
    if (!podeOperarTenant(req.user!)) {
      return res.status(403).json({ erro: 'Sem permissão para esta ação' });
    }

    const {
      nome, ip, fabricante, metodo_monitoramento,
      comunidade_snmp, porta_snmp, intervalo_polling_seg, ativo,
    } = req.body;

    let comunidadeProtegida = dispositivos[0].comunidade_snmp as string | null;
    if (typeof comunidade_snmp === 'string' && comunidade_snmp.trim() !== '') {
      comunidadeProtegida = criptografarSegredo(comunidade_snmp.trim());
    }
    if (metodo_monitoramento !== 'ping' && !comunidadeProtegida) {
      return res.status(400).json({ erro: 'Informe a comunidade SNMP para este metodo de monitoramento.' });
    }

    await pool.query(
      `UPDATE dispositivos SET nome=?, ip=?, fabricante=?, metodo_monitoramento=?,
        comunidade_snmp=?, porta_snmp=?, intervalo_polling_seg=?, ativo=?
       WHERE id=? AND empresa_id=?`,
      [
        nome, ip, fabricante, metodo_monitoramento, comunidadeProtegida,
        porta_snmp, intervalo_polling_seg, ativo ?? true,
        dispositivoId, dispositivos[0].empresa_id,
      ]
    );

    if (ativo !== false) {
      iniciarMonitoramento(dispositivoId, io);
    } else {
      pararMonitoramento(dispositivoId);
      limparAlertas(dispositivoId);
    }

    await registrarAuditoria(
      req.user!.username,
      'editar',
      'dispositivo',
      dispositivoId,
      `Editou dispositivo "${nome}"`,
      req.ip,
      { usuarioId: req.user!.id, empresaId: Number(dispositivos[0].empresa_id) }
    );
    res.json({ ok: true });
  });

  router.delete('/:id', requireRole('admin'), async (req, res) => {
    const dispositivoId = normalizarIdPositivo(req.params.id);
    if (!dispositivoId) return res.status(400).json({ erro: 'Dispositivo inválido' });
    const [dispositivos]: any = await pool.query(
      `SELECT id, empresa_id FROM dispositivos WHERE id = ?`,
      [dispositivoId]
    );
    if (dispositivos.length === 0) return res.status(404).json({ erro: 'Dispositivo não encontrado' });

    pararMonitoramento(dispositivoId);
    limparAlertas(dispositivoId);
    await pool.query(`DELETE FROM dispositivos WHERE id = ? AND empresa_id = ?`, [
      dispositivoId,
      dispositivos[0].empresa_id,
    ]);
    await registrarAuditoria(
      req.user!.username,
      'remover',
      'dispositivo',
      dispositivoId,
      'Removeu dispositivo',
      req.ip,
      { usuarioId: req.user!.id, empresaId: Number(dispositivos[0].empresa_id) }
    );
    res.json({ ok: true });
  });

  return router;
}
