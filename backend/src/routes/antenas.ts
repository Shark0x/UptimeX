import { Router } from 'express';
import { Server as SocketServer } from 'socket.io';
import { pool } from '../db/pool';
import {
  iniciarMonitoramentoAntena,
  pararMonitoramentoAntena,
  executarPingInstantaneo,
  definirSocketIo,
} from '../services/antenaEngine';
import { registrarAuditoria } from '../services/auditService';
import { authMiddleware, requireRole } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import {
  configMapaAntenaSchema,
  criarAntenaSchema,
  criarEnlaceAntenaSchema,
  criarNodeAntenaSchema,
  criarPresetAntenaSchema,
  editarAntenaSchema,
  editarEnlaceAntenaSchema,
  editarNodeAntenaSchema,
  editarPresetAntenaSchema,
  moverNodeAntenaSchema,
  viewportAntenaSchema,
} from '../validation/schemas';

async function executarComConcorrencia<T, R>(itens: T[], limite: number, tarefa: (item: T) => Promise<R>): Promise<R[]> {
  const resultados = new Array<R>(itens.length);
  let proximo = 0;
  async function worker() {
    while (proximo < itens.length) {
      const indice = proximo++;
      resultados[indice] = await tarefa(itens[indice]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limite, itens.length) }, () => worker()));
  return resultados;
}

export function criarAntenasRouter(io: SocketServer) {
  const router = Router();
  definirSocketIo(io);

  // O board de antenas e a infraestrutura global do NOC (fora do escopo de tenants).
  // LEITURA: qualquer usuario autenticado (staff = admin/operador/visualizador) — o
  // visualizador precisa ver a TV. ESCRITA: cada rota exige admin/operador abaixo
  // (visualizador nunca escreve). A RLS do banco reforca isso (app_is_staff / app_can_operate).
  router.use(authMiddleware);

  // Board global do provedor: antenas não pertencem às empresas monitoradas.
  router.get('/', async (_req, res) => {
    try {
      const [rows] = await pool.query(`SELECT * FROM antenas ORDER BY id ASC`);
      res.json(rows);
    } catch {
      res.status(500).json({ erro: 'Falha interna ao processar a operacao.' });
    }
  });

  // Criar nova antena (e opcionalmente o nó visual na topologia)
  router.post('/', requireRole('admin', 'operador'), validateBody(criarAntenaSchema), async (req, res) => {
    const {
      nome,
      ip,
      fabricante = 'ubiquiti',
      modelo = '',
      tipo_wireless = 'ptp_master',
      frequencia_mhz,
      largura_canal_mhz,
      ssid = '',
      sinal_esperado_dbm,
      intervalo_polling_seg = 10,
      criar_no_topologia = true,
      pos_x = 100,
      pos_y = 100,
      tipo_visual,
    } = req.body;

    try {
      const [result]: any = await pool.query(
        `INSERT INTO antenas
         (nome, ip, fabricante, modelo, tipo_wireless, frequencia_mhz, largura_canal_mhz, ssid, sinal_esperado_dbm, intervalo_polling_seg)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING id`,
        [
          nome,
          ip,
          fabricante,
          modelo,
          tipo_wireless,
          frequencia_mhz || null,
          largura_canal_mhz || null,
          ssid,
          sinal_esperado_dbm || null,
          intervalo_polling_seg || 10,
        ]
      );

      const antenaId = Number(result[0].id);

      let nodeId = null;
      if (criar_no_topologia) {
        let tipoVisual = 'antena_ptp';
        if (tipo_wireless.includes('setorial') || tipo_wireless.includes('ap')) tipoVisual = 'antena_setorial';
        else if (tipo_wireless.includes('torre')) tipoVisual = 'torre';
        else if (tipo_wireless.includes('station') || tipo_wireless.includes('cliente')) tipoVisual = 'antena_cpe';
        else if (tipo_wireless.includes('switch')) tipoVisual = 'switch_poe';
        if (tipo_visual) tipoVisual = tipo_visual;

        const [noRes]: any = await pool.query(
          `INSERT INTO antenas_nodes (antena_id, label, tipo_visual, pos_x, pos_y)
           VALUES (?, ?, ?, ?, ?)
           RETURNING id`,
          [antenaId, nome, tipoVisual, pos_x, pos_y]
        );
        nodeId = Number(noRes[0].id);
      }

      iniciarMonitoramentoAntena(antenaId, io);

      await registrarAuditoria(
        req.user!.username,
        'criar',
        'antena',
        antenaId,
        `Antena ${nome} criada`,
        req.ip,
        { usuarioId: req.user!.id }
      );

      res.status(201).json({
        id: antenaId,
        node_id: nodeId,
        nome,
        ip,
        fabricante,
        modelo,
        tipo_wireless,
        status_atual: 'desconhecido',
      });
    } catch {
      res.status(500).json({ erro: 'Falha interna ao processar a operacao.' });
    }
  });

  // Atualizar antena
  router.put('/:id', requireRole('admin', 'operador'), validateBody(editarAntenaSchema), async (req, res) => {
    const id = Number(req.params.id);
    const {
      nome,
      ip,
      fabricante,
      modelo,
      tipo_wireless,
      frequencia_mhz,
      largura_canal_mhz,
      ssid,
      sinal_esperado_dbm,
      intervalo_polling_seg,
      ativo,
      tipo_visual,
    } = req.body;

    try {
      await pool.query(
        `UPDATE antenas
         SET nome = ?, ip = ?, fabricante = ?, modelo = ?, tipo_wireless = ?,
             frequencia_mhz = ?, largura_canal_mhz = ?, ssid = ?,
             sinal_esperado_dbm = ?, intervalo_polling_seg = ?, ativo = ?
         WHERE id = ?`,
        [
          nome,
          ip,
          fabricante,
          modelo,
          tipo_wireless,
          frequencia_mhz || null,
          largura_canal_mhz || null,
          ssid,
          sinal_esperado_dbm || null,
          intervalo_polling_seg || 10,
          ativo !== undefined ? ativo : true,
          id,
        ]
      );

      // Atualiza também o label (e o ícone, se escolhido) do node correspondente na topologia
      await pool.query(
        `UPDATE antenas_nodes SET label = ?, tipo_visual = COALESCE(?, tipo_visual) WHERE antena_id = ?`,
        [nome, tipo_visual || null, id]
      );

      iniciarMonitoramentoAntena(id, io);

      await registrarAuditoria(
        req.user!.username,
        'editar',
        'antena',
        id,
        `Antena ${nome} atualizada`,
        req.ip,
        { usuarioId: req.user!.id }
      );

      res.json({ ok: true, id });
    } catch {
      res.status(500).json({ erro: 'Falha interna ao processar a operacao.' });
    }
  });

  // Excluir antena
  router.delete('/:id', requireRole('admin', 'operador'), async (req, res) => {
    const id = Number(req.params.id);
    try {
      pararMonitoramentoAntena(id);
      await pool.query(`DELETE FROM antenas WHERE id = ?`, [id]);

      await registrarAuditoria(
        req.user!.username,
        'remover',
        'antena',
        id,
        `Antena #${id} removida`,
        req.ip,
        { usuarioId: req.user!.id }
      );

      res.status(204).end();
    } catch {
      res.status(500).json({ erro: 'Falha interna ao processar a operacao.' });
    }
  });

  // Ping instantâneo
  router.post('/:id/ping', requireRole('admin', 'operador'), async (req, res) => {
    const id = Number(req.params.id);
    try {
      const resultado = await executarPingInstantaneo(id);
      res.json(resultado);
    } catch {
      res.status(500).json({ erro: 'Falha interna ao processar a operacao.' });
    }
  });

  // Ping em todas as antenas do provedor
  router.post('/ping-todos', requireRole('admin', 'operador'), async (_req, res) => {
    try {
      const [rows]: any = await pool.query(`SELECT id FROM antenas WHERE ativo = TRUE`);
      const resultados = await executarComConcorrencia(rows, 5, (r: any) =>
        executarPingInstantaneo(r.id).catch(() => null)
      );
      res.json({ total: rows.length, resultados });
    } catch {
      res.status(500).json({ erro: 'Falha interna ao processar a operacao.' });
    }
  });

  // Métricas históricas da antena
  router.get('/:id/metricas', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ erro: 'Antena invalida.' });
    const minutos = Math.min(Math.max(Number(req.query.minutos) || 60, 5), 60 * 24 * 7);
    try {
      if (minutos > 360) {
        const [agregados] = await pool.query(
          `SELECT to_timestamp(floor(extract(epoch from "timestamp") / 300) * 300) AT TIME ZONE 'UTC' AS "timestamp",
                  AVG(latencia_ms) AS latencia_ms, MAX(perda_pct) AS perda_pct
           FROM antenas_metricas
           WHERE antena_id = ? AND "timestamp" >= NOW() - (? * INTERVAL '1 minute')
           GROUP BY 1 ORDER BY 1 ASC`,
          [id, minutos]
        );
        return res.json(agregados);
      }
      const [rows] = await pool.query(
        `SELECT latencia_ms, perda_pct, "timestamp" FROM (
           SELECT latencia_ms, perda_pct, "timestamp"
           FROM antenas_metricas
           WHERE antena_id = ? AND "timestamp" >= NOW() - (? * INTERVAL '1 minute')
           ORDER BY "timestamp" DESC LIMIT 2000
         ) recentes ORDER BY "timestamp" ASC`,
        [id, minutos]
      );
      res.json(rows);
    } catch {
      res.status(500).json({ erro: 'Falha interna ao processar a operacao.' });
    }
  });

  // Snapshot do board AO VIVO (nós + enlaces + viewport). Reusado pela topologia
  // e pelos presets (criar/carregar). LIMIT 1 no viewport também lê instalações
  // antigas em que a linha ainda tinha empresa_id em vez do id fixo do board global.
  async function snapshotAoVivo() {
    const [nodes]: any = await pool.query(
      `SELECT n.id, n.antena_id, n.label, n.tipo_visual, n.pos_x, n.pos_y,
             a.ip, a.fabricante, a.modelo, a.tipo_wireless, a.frequencia_mhz,
             a.largura_canal_mhz, a.ssid, a.sinal_esperado_dbm,
             a.status_atual, a.latencia_ms, a.perda_pct, a.ultima_verificacao
      FROM antenas_nodes n
      LEFT JOIN antenas a ON n.antena_id = a.id
      ORDER BY n.id ASC`
    );
    const [edges]: any = await pool.query(
      `SELECT id, origem_node_id, destino_node_id, tipo_enlace, label, frequencia, distancia_km, capacidade_mbps, cor, curvo, espessura, estilo, animado, origem_lado, destino_lado, formato, mostrar_label
      FROM antenas_enlaces
      ORDER BY id ASC`
    );
    const [vp]: any = await pool.query(
      `SELECT pos_x, pos_y, zoom, ocultar_labels FROM antenas_viewport LIMIT 1`
    );
    return { nodes, edges, viewport: vp[0] || { pos_x: 0, pos_y: 0, zoom: 1, ocultar_labels: false } };
  }

  // Obter o board único da infraestrutura wireless do provedor (board AO VIVO)
  router.get('/topologia', async (_req, res) => {
    try {
      res.json(await snapshotAoVivo());
    } catch {
      res.status(500).json({ erro: 'Falha interna ao processar a operacao.' });
    }
  });

  // Criar nó na topologia
  router.post('/topologia/nodes', requireRole('admin', 'operador'), validateBody(criarNodeAntenaSchema), async (req, res) => {
    const { antena_id, label, tipo_visual = 'antena_ptp', pos_x = 0, pos_y = 0 } = req.body;
    if (!label) return res.status(400).json({ erro: 'label é obrigatório' });

    try {
      const [result]: any = await pool.query(
        `INSERT INTO antenas_nodes (antena_id, label, tipo_visual, pos_x, pos_y)
         VALUES (?, ?, ?, ?, ?)
         RETURNING id`,
        [antena_id || null, label, tipo_visual, pos_x, pos_y]
      );
      res.status(201).json({ id: Number(result[0].id), antena_id, label, tipo_visual, pos_x, pos_y });
    } catch {
      res.status(500).json({ erro: 'Falha interna ao processar a operacao.' });
    }
  });

  // Editar label/ícone de um nó (antena vinculada ou nó decorativo)
  router.put('/topologia/nodes/:id', requireRole('admin', 'operador'), validateBody(editarNodeAntenaSchema), async (req, res) => {
    const id = Number(req.params.id);
    const { label, tipo_visual } = req.body;
    try {
      await pool.query(
        `UPDATE antenas_nodes SET label = COALESCE(?, label), tipo_visual = COALESCE(?, tipo_visual) WHERE id = ?`,
        [label || null, tipo_visual || null, id]
      );
      res.json({ ok: true });
    } catch {
      res.status(500).json({ erro: 'Falha interna ao processar a operacao.' });
    }
  });

  // Mover posição do nó
  router.put('/topologia/nodes/:id/posicao', requireRole('admin', 'operador'), validateBody(moverNodeAntenaSchema), async (req, res) => {
    const id = Number(req.params.id);
    const { pos_x, pos_y } = req.body;
    try {
      await pool.query(`UPDATE antenas_nodes SET pos_x = ?, pos_y = ? WHERE id = ?`, [pos_x, pos_y, id]);
      res.json({ ok: true });
    } catch {
      res.status(500).json({ erro: 'Falha interna ao processar a operacao.' });
    }
  });

  // Remover nó da topologia
  router.delete('/topologia/nodes/:id', requireRole('admin', 'operador'), async (req, res) => {
    const id = Number(req.params.id);
    try {
      await pool.query(`DELETE FROM antenas_nodes WHERE id = ?`, [id]);
      res.status(204).end();
    } catch {
      res.status(500).json({ erro: 'Falha interna ao processar a operacao.' });
    }
  });

  // Criar enlace (Edge)
  router.post('/topologia/edges', requireRole('admin', 'operador'), validateBody(criarEnlaceAntenaSchema), async (req, res) => {
    const {
      origem_node_id,
      destino_node_id,
      tipo_enlace = 'ptp_wireless',
      label = '',
      frequencia = '',
      distancia_km = null,
      capacidade_mbps = null,
      cor = null,
      curvo = false,
      espessura = null,
      estilo = null,
      animado = null,
      origem_lado = null,
      destino_lado = null,
      formato = null,
      mostrar_label = true,
    } = req.body;

    if (!origem_node_id || !destino_node_id) {
      return res.status(400).json({ erro: 'origem e destino são obrigatórios' });
    }

    const animadoVal = animado === null || animado === undefined ? null : !!animado;
    const mostrarLabelVal = mostrar_label === undefined || mostrar_label === null ? true : !!mostrar_label;
    try {
      const [result]: any = await pool.query(
        `INSERT INTO antenas_enlaces
         (origem_node_id, destino_node_id, tipo_enlace, label, frequencia, distancia_km, capacidade_mbps, cor, curvo, espessura, estilo, animado, origem_lado, destino_lado, formato, mostrar_label)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING id`,
        [origem_node_id, destino_node_id, tipo_enlace, label, frequencia, distancia_km, capacidade_mbps, cor, !!curvo, espessura, estilo, animadoVal, origem_lado, destino_lado, formato, mostrarLabelVal]
      );
      res.status(201).json({ id: Number(result[0].id), origem_node_id, destino_node_id, tipo_enlace, label, frequencia, distancia_km, capacidade_mbps, cor, curvo: !!curvo, espessura, estilo, animado: animadoVal, origem_lado, destino_lado, formato, mostrar_label: mostrarLabelVal });
    } catch {
      res.status(500).json({ erro: 'Falha interna ao processar a operacao.' });
    }
  });

  // Editar enlace (nome, tipo, cor, reta/curva, espessura, estilo, fluxo, frequência, distância, capacidade)
  router.put('/topologia/edges/:id', requireRole('admin', 'operador'), validateBody(editarEnlaceAntenaSchema), async (req, res) => {
    const id = Number(req.params.id);
    const { tipo_enlace, label, cor, curvo, frequencia, distancia_km, capacidade_mbps, espessura, estilo, animado, origem_lado, destino_lado, formato, mostrar_label, origem_node_id, destino_node_id } = req.body;
    const animadoVal = animado === undefined || animado === null ? null : !!animado;
    const mostrarLabelVal = mostrar_label === undefined || mostrar_label === null ? null : !!mostrar_label;
    try {
      // Reconexão pelo canvas (arrastar a ponta): valida os novos nós antes de trocar.
      if (origem_node_id !== undefined || destino_node_id !== undefined) {
        const [atual]: any = await pool.query(
          `SELECT origem_node_id, destino_node_id FROM antenas_enlaces WHERE id = ?`,
          [id]
        );
        if (!atual.length) return res.status(404).json({ erro: 'Enlace não encontrado' });
        const novoOrig = Number(origem_node_id ?? atual[0].origem_node_id);
        const novoDest = Number(destino_node_id ?? atual[0].destino_node_id);
        if (novoOrig === novoDest) {
          return res.status(400).json({ erro: 'Origem e destino devem ser diferentes.' });
        }
        const [nodes]: any = await pool.query(
          `SELECT id FROM antenas_nodes WHERE id IN (?, ?)`,
          [novoOrig, novoDest]
        );
        if (nodes.length < 2) {
          return res.status(404).json({ erro: 'Nó de origem ou destino não existe.' });
        }
      }
      await pool.query(
        `UPDATE antenas_enlaces
         SET origem_node_id = COALESCE(?, origem_node_id),
             destino_node_id = COALESCE(?, destino_node_id),
             tipo_enlace = COALESCE(?, tipo_enlace),
             label = COALESCE(?, label),
             cor = ?,
             curvo = COALESCE(?, curvo),
             frequencia = COALESCE(?, frequencia),
             distancia_km = COALESCE(?, distancia_km),
             capacidade_mbps = COALESCE(?, capacidade_mbps),
             espessura = ?,
             estilo = ?,
             animado = ?,
             origem_lado = ?,
             destino_lado = ?,
             formato = ?,
             mostrar_label = COALESCE(?, mostrar_label)
         WHERE id = ?`,
        [origem_node_id ?? null, destino_node_id ?? null, tipo_enlace || null, label || null, cor ?? null, curvo === undefined ? null : !!curvo, frequencia || null, distancia_km ?? null, capacidade_mbps ?? null, espessura ?? null, estilo ?? null, animadoVal, origem_lado ?? null, destino_lado ?? null, formato ?? null, mostrarLabelVal, id]
      );
      const [rows]: any = await pool.query(`SELECT * FROM antenas_enlaces WHERE id = ?`, [id]);
      res.json(rows[0] || { ok: true, id });
    } catch {
      res.status(500).json({ erro: 'Falha interna ao processar a operacao.' });
    }
  });

  // Remover enlace
  router.delete('/topologia/edges/:id', requireRole('admin', 'operador'), async (req, res) => {
    const id = Number(req.params.id);
    try {
      await pool.query(`DELETE FROM antenas_enlaces WHERE id = ?`, [id]);
      res.status(204).end();
    } catch {
      res.status(500).json({ erro: 'Falha interna ao processar a operacao.' });
    }
  });

  // Salvar o enquadramento do board global
  router.put('/topologia/viewport', requireRole('admin', 'operador'), validateBody(viewportAntenaSchema), async (req, res) => {
    const { pos_x, pos_y, zoom } = req.body;
    try {
      // Board global: uma unica linha (id = 1) guarda o enquadramento do mapa.
      await pool.query(
        `INSERT INTO antenas_viewport (id, pos_x, pos_y, zoom)
         VALUES (1, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET pos_x = EXCLUDED.pos_x, pos_y = EXCLUDED.pos_y, zoom = EXCLUDED.zoom`,
        [pos_x, pos_y, zoom]
      );
      res.json({ ok: true });
    } catch {
      res.status(500).json({ erro: 'Falha interna ao processar a operacao.' });
    }
  });

  // Config global do board (ex.: ocultar todos os rotulos das conexoes de uma vez).
  // Fica na mesma linha unica (id = 1) do viewport pra ser compartilhada entre telas.
  router.put('/topologia/config', requireRole('admin', 'operador'), validateBody(configMapaAntenaSchema), async (req, res) => {
    const ocultarLabels = !!req.body.ocultar_labels;
    try {
      await pool.query(
        `INSERT INTO antenas_viewport (id, ocultar_labels)
         VALUES (1, ?)
         ON CONFLICT (id) DO UPDATE SET ocultar_labels = EXCLUDED.ocultar_labels`,
        [ocultarLabels]
      );
      res.json({ ok: true, ocultar_labels: ocultarLabels });
    } catch {
      res.status(500).json({ erro: 'Falha interna ao processar a operacao.' });
    }
  });

  // ===================== PRESETS DA TOPOLOGIA =====================
  // Versões salvas (snapshots) do board. A TV mostra o preset marcado como ativo,
  // então editar o board ao vivo NÃO muda a TV até salvar/ativar um preset. Assim
  // ninguém altera sem querer o que está sendo exibido. Escrita = admin/operador.

  // Lista os presets (staff lê)
  router.get('/topologia/presets', async (_req, res) => {
    try {
      const [rows]: any = await pool.query(
        `SELECT id, nome, ativo_tv, atualizado_em FROM antenas_presets ORDER BY atualizado_em DESC, id DESC`
      );
      res.json(rows);
    } catch {
      res.status(500).json({ erro: 'Falha interna ao processar a operacao.' });
    }
  });

  // Snapshot pra TV: o preset ativo (congelado). Sem preset ativo, cai no board ao vivo.
  router.get('/topologia/tv', async (_req, res) => {
    try {
      const [rows]: any = await pool.query(
        `SELECT dados FROM antenas_presets WHERE ativo_tv = TRUE LIMIT 1`
      );
      if (rows[0]?.dados) {
        const dados = typeof rows[0].dados === 'string' ? JSON.parse(rows[0].dados) : rows[0].dados;
        return res.json(dados);
      }
      res.json(await snapshotAoVivo());
    } catch {
      res.status(500).json({ erro: 'Falha interna ao processar a operacao.' });
    }
  });

  // Cria um preset a partir do board AO VIVO atual
  router.post('/topologia/presets', requireRole('admin', 'operador'), validateBody(criarPresetAntenaSchema), async (req, res) => {
    try {
      const snap = await snapshotAoVivo();
      const [ins]: any = await pool.query(
        `INSERT INTO antenas_presets (nome, dados, atualizado_por)
         VALUES (?, ?::jsonb, ?) RETURNING id, nome, ativo_tv, atualizado_em`,
        [req.body.nome, JSON.stringify(snap), req.user!.id]
      );
      await registrarAuditoria(req.user!.username, 'criar', 'antena_preset', ins[0].id, `Preset "${req.body.nome}"`, req.ip, { usuarioId: req.user!.id });
      res.status(201).json(ins[0]);
    } catch {
      res.status(500).json({ erro: 'Falha interna ao processar a operacao.' });
    }
  });

  // Renomeia e/ou re-salva o snapshot do board no preset
  router.put('/topologia/presets/:id', requireRole('admin', 'operador'), validateBody(editarPresetAntenaSchema), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ erro: 'ID invalido.' });
    try {
      const sets: string[] = [];
      const params: any[] = [];
      if (req.body.nome !== undefined) { sets.push('nome = ?'); params.push(req.body.nome); }
      if (req.body.resnapshot === true) { sets.push('dados = ?::jsonb'); params.push(JSON.stringify(await snapshotAoVivo())); }
      sets.push('atualizado_em = now()', 'atualizado_por = ?');
      params.push(req.user!.id, id);
      const [upd]: any = await pool.query(
        `UPDATE antenas_presets SET ${sets.join(', ')} WHERE id = ? RETURNING id, nome, ativo_tv, atualizado_em`,
        params
      );
      if (!upd[0]) return res.status(404).json({ erro: 'Preset nao encontrado.' });
      res.json(upd[0]);
    } catch {
      res.status(500).json({ erro: 'Falha interna ao processar a operacao.' });
    }
  });

  // Marca um preset como ativo pra TV (desmarca os outros, em transação)
  router.post('/topologia/presets/:id/ativar', requireRole('admin', 'operador'), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ erro: 'ID invalido.' });
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [existe]: any = await conn.query(`SELECT id FROM antenas_presets WHERE id = ?`, [id]);
      if (!existe[0]) { await conn.rollback(); return res.status(404).json({ erro: 'Preset nao encontrado.' }); }
      await conn.query(`UPDATE antenas_presets SET ativo_tv = FALSE WHERE ativo_tv = TRUE`);
      await conn.query(`UPDATE antenas_presets SET ativo_tv = TRUE WHERE id = ?`, [id]);
      await conn.commit();
      await registrarAuditoria(req.user!.username, 'atualizar', 'antena_preset', id, 'Preset ativado na TV', req.ip, { usuarioId: req.user!.id });
      res.json({ ok: true });
    } catch {
      await conn.rollback();
      res.status(500).json({ erro: 'Falha interna ao processar a operacao.' });
    } finally {
      conn.release();
    }
  });

  // Carrega o snapshot do preset de volta pro board AO VIVO (substitui nós/enlaces/viewport)
  router.post('/topologia/presets/:id/carregar', requireRole('admin', 'operador'), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ erro: 'ID invalido.' });
    const conn = await pool.getConnection();
    try {
      const [rows]: any = await conn.query(`SELECT dados FROM antenas_presets WHERE id = ?`, [id]);
      if (!rows[0]) { conn.release(); return res.status(404).json({ erro: 'Preset nao encontrado.' }); }
      const dados = typeof rows[0].dados === 'string' ? JSON.parse(rows[0].dados) : rows[0].dados;
      const nodes: any[] = Array.isArray(dados?.nodes) ? dados.nodes : [];
      const edges: any[] = Array.isArray(dados?.edges) ? dados.edges : [];
      const vp = dados?.viewport || { pos_x: 0, pos_y: 0, zoom: 1, ocultar_labels: false };

      await conn.beginTransaction();
      // Limpa o board (enlaces antes dos nós por causa das FKs)
      await conn.query(`DELETE FROM antenas_enlaces`);
      await conn.query(`DELETE FROM antenas_nodes`);

      // Recria os nós com ids NOVOS; mapa id_antigo -> id_novo pra remapear os enlaces.
      const mapa = new Map<number, number>();
      for (const n of nodes) {
        // antena_id via subquery: se a antena foi removida desde o snapshot, entra NULL.
        const [ins]: any = await conn.query(
          `INSERT INTO antenas_nodes (antena_id, label, tipo_visual, pos_x, pos_y)
           VALUES ((SELECT id FROM antenas WHERE id = ?), ?, ?, ?, ?) RETURNING id`,
          [n.antena_id ?? null, String(n.label ?? ''), String(n.tipo_visual ?? 'antena_ptp'), Number(n.pos_x) || 0, Number(n.pos_y) || 0]
        );
        mapa.set(Number(n.id), Number(ins[0].id));
      }
      for (const e of edges) {
        const origem = mapa.get(Number(e.origem_node_id));
        const destino = mapa.get(Number(e.destino_node_id));
        if (!origem || !destino) continue; // enlace órfão no snapshot: ignora
        await conn.query(
          `INSERT INTO antenas_enlaces
             (origem_node_id, destino_node_id, tipo_enlace, label, frequencia, distancia_km, capacidade_mbps, cor, curvo, espessura, estilo, animado, origem_lado, destino_lado, formato, mostrar_label)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [origem, destino, e.tipo_enlace ?? 'ptp_wireless', e.label ?? null, e.frequencia ?? null, e.distancia_km ?? null, e.capacidade_mbps ?? null, e.cor ?? null, !!e.curvo, e.espessura ?? null, e.estilo ?? null, e.animado ?? null, e.origem_lado ?? null, e.destino_lado ?? null, e.formato ?? null, e.mostrar_label ?? true]
        );
      }
      await conn.query(
        `INSERT INTO antenas_viewport (id, pos_x, pos_y, zoom, ocultar_labels)
         VALUES (1, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET pos_x = EXCLUDED.pos_x, pos_y = EXCLUDED.pos_y, zoom = EXCLUDED.zoom, ocultar_labels = EXCLUDED.ocultar_labels`,
        [Number(vp.pos_x) || 0, Number(vp.pos_y) || 0, Number(vp.zoom) || 1, !!vp.ocultar_labels]
      );
      await conn.commit();
      await registrarAuditoria(req.user!.username, 'atualizar', 'antena_preset', id, 'Preset carregado no editor', req.ip, { usuarioId: req.user!.id });
      res.json({ ok: true });
    } catch {
      await conn.rollback();
      res.status(500).json({ erro: 'Falha interna ao processar a operacao.' });
    } finally {
      conn.release();
    }
  });

  // Exclui um preset
  router.delete('/topologia/presets/:id', requireRole('admin', 'operador'), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ erro: 'ID invalido.' });
    try {
      const [del]: any = await pool.query(`DELETE FROM antenas_presets WHERE id = ? RETURNING id`, [id]);
      if (!del[0]) return res.status(404).json({ erro: 'Preset nao encontrado.' });
      await registrarAuditoria(req.user!.username, 'remover', 'antena_preset', id, 'Preset removido', req.ip, { usuarioId: req.user!.id });
      res.json({ ok: true });
    } catch {
      res.status(500).json({ erro: 'Falha interna ao processar a operacao.' });
    }
  });

  return router;
}
