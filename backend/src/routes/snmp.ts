import { Router } from 'express';
import { Server as SocketServer } from 'socket.io';
import { pool } from '../db/pool';
import { authMiddleware, requireRole } from '../middleware/auth';
import { filtroEmpresaSql, normalizarIdPositivo } from '../security/tenantAccess';
import { registrarAuditoria } from '../services/auditService';
import { verificarSnmpAgora } from '../services/snmp/engine';

// Rotas de métricas SNMP (interfaces, tráfego, estado da coleta). Leitura por
// staff (RLS app_is_staff); coleta sob demanda exige operador+.
export function criarSnmpRouter(io: SocketServer) {
  const router = Router();
  router.use(authMiddleware);

  // Garante que o dispositivo existe e é acessível pelo usuário (escopo tenant).
  async function dispositivoAcessivel(req: any, dispositivoId: number) {
    const escopo = filtroEmpresaSql(req.user!, 'd.empresa_id');
    const [rows]: any = await pool.query(
      `SELECT d.id, d.empresa_id, d.intervalo_polling_seg FROM dispositivos d
       WHERE d.id = ? AND ${escopo.sql}`,
      [dispositivoId, ...escopo.params]
    );
    return rows[0] || null;
  }

  // Estado da coleta: uptime, descrição do sistema, última coleta e se está atrasada.
  router.get('/dispositivo/:id/estado', async (req, res) => {
    const dispositivoId = normalizarIdPositivo(req.params.id);
    if (!dispositivoId) return res.status(400).json({ erro: 'Dispositivo inválido' });
    const disp = await dispositivoAcessivel(req, dispositivoId);
    if (!disp) return res.status(404).json({ erro: 'Dispositivo não encontrado' });

    const [rows]: any = await pool.query(
      `SELECT c.status, c.sys_uptime_ticks, c.sys_descr, c.sys_name,
              c.ultima_coleta_at, c.ultimo_sucesso_at, c.falhas_consecutivas,
              c.erro, c.total_interfaces,
              c.cpu_pct, c.cpu_cores,
              c.memoria_uso_bytes, c.memoria_total_bytes, c.memoria_pct,
              c.disco_uso_bytes, c.disco_total_bytes, c.disco_pct,
              (c.ultima_coleta_at IS NULL
               OR c.ultima_coleta_at < now() - make_interval(secs => d.intervalo_polling_seg * 2.5)) AS atrasada
       FROM dispositivos d
       LEFT JOIN snmp_coleta c ON c.dispositivo_id = d.id
       WHERE d.id = ?`,
      [dispositivoId]
    );
    const estado = rows[0] || null;
    res.json(estado && estado.status ? estado : { status: 'pendente', atrasada: true });
  });

  // Interfaces descobertas + tráfego instantâneo (última taxa calculada).
  router.get('/dispositivo/:id/interfaces', async (req, res) => {
    const dispositivoId = normalizarIdPositivo(req.params.id);
    if (!dispositivoId) return res.status(400).json({ erro: 'Dispositivo inválido' });
    const disp = await dispositivoAcessivel(req, dispositivoId);
    if (!disp) return res.status(404).json({ erro: 'Dispositivo não encontrado' });

    const [rows] = await pool.query(
      `SELECT if_index, if_descr, if_name, if_alias, if_type, capacidade_bps,
              admin_status, oper_status, in_bps, out_bps, last_sample_at, atualizado_em
       FROM snmp_interfaces
       WHERE dispositivo_id = ? AND visivel = TRUE
       ORDER BY if_index`,
      [dispositivoId]
    );
    res.json(rows);
  });

  // Série temporal de tráfego de uma interface (bps/pps) para os gráficos.
  router.get('/dispositivo/:id/interfaces/:ifIndex/historico', async (req, res) => {
    const dispositivoId = normalizarIdPositivo(req.params.id);
    const ifIndex = Number(req.params.ifIndex);
    if (!dispositivoId || !Number.isInteger(ifIndex) || ifIndex < 0) {
      return res.status(400).json({ erro: 'Parâmetros inválidos' });
    }
    const disp = await dispositivoAcessivel(req, dispositivoId);
    if (!disp) return res.status(404).json({ erro: 'Dispositivo não encontrado' });

    const minutos = Math.min(Math.max(Number(req.query.minutos) || 60, 5), 60 * 24 * 7);
    const [rows] = await pool.query(
      `SELECT "timestamp", in_bps, out_bps, in_err_pps, out_err_pps, in_disc_pps, out_disc_pps
       FROM snmp_interface_amostras
       WHERE dispositivo_id = ? AND if_index = ?
         AND "timestamp" >= now() - (? * interval '1 minute')
       ORDER BY "timestamp" ASC`,
      [dispositivoId, ifIndex, minutos]
    );
    res.json(rows);
  });

  // Série temporal de recursos (CPU, Memória, Disco) para os gráficos.
  router.get('/dispositivo/:id/recursos/historico', async (req, res) => {
    const dispositivoId = normalizarIdPositivo(req.params.id);
    if (!dispositivoId) return res.status(400).json({ erro: 'Dispositivo inválido' });
    const disp = await dispositivoAcessivel(req, dispositivoId);
    if (!disp) return res.status(404).json({ erro: 'Dispositivo não encontrado' });

    const minutos = Math.min(Math.max(Number(req.query.minutos) || 60, 5), 60 * 24 * 7);
    const [rows] = await pool.query(
      `SELECT "timestamp", cpu_pct, cpu_cores, memoria_pct, memoria_uso_bytes, memoria_total_bytes,
              disco_pct, disco_uso_bytes, disco_total_bytes
       FROM snmp_recursos_amostras
       WHERE dispositivo_id = ?
         AND "timestamp" >= now() - (? * interval '1 minute')
       ORDER BY "timestamp" ASC`,
      [dispositivoId, minutos]
    );
    res.json(rows);
  });

  // Coleta SNMP sob demanda ("Coletar agora"). Operador+. Serializada com o ciclo.
  router.post('/dispositivo/:id/coletar', requireRole('admin', 'operador'), async (req, res) => {
    const dispositivoId = normalizarIdPositivo(req.params.id);
    if (!dispositivoId) return res.status(400).json({ erro: 'Dispositivo inválido' });
    const disp = await dispositivoAcessivel(req, dispositivoId);
    if (!disp) return res.status(404).json({ erro: 'Dispositivo não encontrado' });

    const resultado = await verificarSnmpAgora(dispositivoId, io);
    if (!resultado) return res.status(404).json({ erro: 'Dispositivo não encontrado' });
    await registrarAuditoria(
      req.user!.username, 'testar', 'dispositivo', dispositivoId,
      'Coleta SNMP sob demanda', req.ip,
      { usuarioId: req.user!.id, empresaId: Number(disp.empresa_id) }
    );
    res.json({ ok: true, ...resultado });
  });

  return router;
}
