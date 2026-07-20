import { Router } from 'express';
import { Server as SocketServer } from 'socket.io';
import { pool } from '../db/pool';
import { registrarAuditoria } from '../services/auditService';
import { iniciarMonitoramento, pararMonitoramento } from '../services/monitorEngine';
import { limparAlertas } from '../services/alertaService';
import { authMiddleware, requireRole } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { criarDispositivoSchema, editarDispositivoSchema } from '../validation/schemas';

export function criarDispositivosRouter(io: SocketServer) {
  const router = Router();

  router.use(authMiddleware);

  router.get('/empresa/:empresaId', async (req, res) => {
    const [rows] = await pool.query(
      `SELECT * FROM dispositivos WHERE empresa_id = ? ORDER BY nome`,
      [req.params.empresaId]
    );
    res.json(rows);
  });

  router.get('/:id/historico', async (req, res) => {
    const limite = Number(req.query.limite) || 100;
    const [rows] = await pool.query(
      `SELECT * FROM status_eventos WHERE dispositivo_id = ? ORDER BY inicio DESC LIMIT ?`,
      [req.params.id, limite]
    );
    res.json(rows);
  });

  // Amostras de latência/perda pros gráficos do drawer. Janelas longas são agregadas
  // em baldes de 5 min pra resposta não passar de alguns milhares de pontos.
  router.get('/:id/metricas', async (req, res) => {
    const minutos = Math.min(Math.max(Number(req.query.minutos) || 60, 5), 60 * 24 * 7);

    if (minutos > 360) {
      const [rows] = await pool.query(
        `SELECT FROM_UNIXTIME(FLOOR(UNIX_TIMESTAMP(timestamp) / 300) * 300) AS timestamp,
                AVG(latencia_ms) AS latencia_ms,
                MAX(perda_pct) AS perda_pct
         FROM ping_metricas
         WHERE dispositivo_id = ? AND timestamp >= NOW() - INTERVAL ? MINUTE
         GROUP BY 1 ORDER BY 1 ASC`,
        [req.params.id, minutos]
      );
      return res.json(rows);
    }

    const [rows] = await pool.query(
      `SELECT latencia_ms, perda_pct, timestamp
       FROM ping_metricas
       WHERE dispositivo_id = ? AND timestamp >= NOW() - INTERVAL ? MINUTE
       ORDER BY timestamp ASC`,
      [req.params.id, minutos]
    );
    res.json(rows);
  });

  router.post('/', requireRole('admin'), validateBody(criarDispositivoSchema), async (req, res) => {
    const {
      empresa_id, nome, ip, fabricante, metodo_monitoramento,
      comunidade_snmp, porta_snmp, intervalo_polling_seg,
    } = req.body;

    const [result]: any = await pool.query(
      `INSERT INTO dispositivos
        (empresa_id, nome, ip, fabricante, metodo_monitoramento, comunidade_snmp, porta_snmp, intervalo_polling_seg)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        empresa_id, nome, ip,
        fabricante || 'generico',
        metodo_monitoramento || 'snmp+ping',
        comunidade_snmp || 'public',
        porta_snmp || 161,
        intervalo_polling_seg || 30,
      ]
    );

    const novoId = result.insertId;
    iniciarMonitoramento(novoId, io);
    await registrarAuditoria(req.user!.username, 'criar', 'dispositivo', novoId, `Criou dispositivo "${nome}" (${ip})`);
    res.status(201).json({ id: novoId });
  });

  router.put('/:id', requireRole('admin'), validateBody(editarDispositivoSchema), async (req, res) => {
    const {
      nome, ip, fabricante, metodo_monitoramento,
      comunidade_snmp, porta_snmp, intervalo_polling_seg, ativo,
    } = req.body;

    await pool.query(
      `UPDATE dispositivos SET nome=?, ip=?, fabricante=?, metodo_monitoramento=?,
        comunidade_snmp=?, porta_snmp=?, intervalo_polling_seg=?, ativo=? WHERE id=?`,
      [nome, ip, fabricante, metodo_monitoramento, comunidade_snmp, porta_snmp, intervalo_polling_seg, ativo, req.params.id]
    );

    // Reinicia o polling pra aplicar mudanças de intervalo/método, ou para se foi desativado
    if (ativo) {
      iniciarMonitoramento(Number(req.params.id), io);
    } else {
      pararMonitoramento(Number(req.params.id));
      limparAlertas(Number(req.params.id));
    }

    await registrarAuditoria(req.user!.username, 'editar', 'dispositivo', Number(req.params.id), `Editou dispositivo "${nome}"`);
    res.json({ ok: true });
  });

  router.delete('/:id', requireRole('admin'), async (req, res) => {
    pararMonitoramento(Number(req.params.id));
    limparAlertas(Number(req.params.id));
    await pool.query(`DELETE FROM dispositivos WHERE id = ?`, [req.params.id]);
    await registrarAuditoria(req.user!.username, 'remover', 'dispositivo', Number(req.params.id), 'Removeu dispositivo');
    res.json({ ok: true });
  });

  return router;
}
