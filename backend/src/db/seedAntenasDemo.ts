import { pool, withUserContext } from './pool';

type Demo = {
  chave: string;
  nome: string;
  ip: string;
  fabricante: string;
  modelo: string;
  tipo: string;
  frequencia: number | null;
  canal: number | null;
  ssid: string;
  sinal: number | null;
  visual: string;
  x: number;
  y: number;
};

const equipamentos: Demo[] = [
  { chave: 'core', nome: '[DEMO] POP Central — Core', ip: '1.1.1.1', fabricante: 'cisco', modelo: 'ASR 1001-X', tipo: 'torre', frequencia: null, canal: null, ssid: 'CORE-NOC', sinal: null, visual: 'torre', x: 520, y: 60 },
  { chave: 'norte_tx', nome: '[DEMO] PTP Norte — Master', ip: '8.8.8.8', fabricante: 'ubiquiti', modelo: 'AirFiber 5XHD', tipo: 'ptp_master', frequencia: 5800, canal: 80, ssid: 'BACKBONE-NORTE', sinal: -48, visual: 'antena_ptp', x: 250, y: 230 },
  { chave: 'norte_pop', nome: '[DEMO] Torre Norte — POP', ip: '8.8.4.4', fabricante: 'mikrotik', modelo: 'NetMetal 5 ac', tipo: 'ptp_slave', frequencia: 5800, canal: 80, ssid: 'BACKBONE-NORTE', sinal: -52, visual: 'torre', x: 70, y: 430 },
  { chave: 'leste_tx', nome: '[DEMO] PTP Leste — Master', ip: '9.9.9.9', fabricante: 'mimosa', modelo: 'Mimosa B5c', tipo: 'ptp_master', frequencia: 5650, canal: 80, ssid: 'BACKBONE-LESTE', sinal: -50, visual: 'antena_ptp', x: 790, y: 230 },
  { chave: 'leste_pop', nome: '[DEMO] Torre Leste — POP', ip: '149.112.112.112', fabricante: 'cambium', modelo: 'PTP 550', tipo: 'ptp_slave', frequencia: 5650, canal: 80, ssid: 'BACKBONE-LESTE', sinal: -54, visual: 'torre', x: 970, y: 430 },
  { chave: 'backup', nome: '[DEMO] Enlace Backup — OpenDNS', ip: '208.67.222.222', fabricante: 'intelbras', modelo: 'APC 5A-15D', tipo: 'repetidora', frequencia: 5200, canal: 40, ssid: 'BACKUP-NOC', sinal: -61, visual: 'antena_setorial', x: 520, y: 420 },
  { chave: 'remoto', nome: '[DEMO] POP Remoto — Sul', ip: '208.67.220.220', fabricante: 'ubiquiti', modelo: 'PowerBeam 5AC Gen2', tipo: 'ptmp_station', frequencia: 5200, canal: 40, ssid: 'BACKUP-NOC', sinal: -58, visual: 'antena_cpe', x: 520, y: 640 },
];

// O board de antenas so aceita escrita de admin (RLS admin-only). O seed roda no
// contexto de um admin; por padrao usa o id 1 (primeiro admin do bootstrap).
const ADMIN_ID = Number(process.env.SEED_ADMIN_ID) || 1;

async function semear() {
  const [jaExiste]: any = await pool.query(`SELECT COUNT(*) AS total FROM antenas WHERE nome LIKE '[DEMO]%'`);
  if (Number(jaExiste[0].total) > 0) {
    console.log('Topologia DEMO já existe; nenhuma duplicação foi criada.');
    return;
  }

  const ids = new Map<string, { antena: number; node: number }>();
  for (const item of equipamentos) {
    const [ant]: any = await pool.query(
      `INSERT INTO antenas (nome, ip, fabricante, modelo, tipo_wireless, frequencia_mhz, largura_canal_mhz, ssid, sinal_esperado_dbm, intervalo_polling_seg)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 10)
       RETURNING id`,
      [item.nome, item.ip, item.fabricante, item.modelo, item.tipo, item.frequencia, item.canal, item.ssid, item.sinal]
    );
    const antenaId = Number(ant[0].id);
    const [node]: any = await pool.query(
      `INSERT INTO antenas_nodes (antena_id, label, tipo_visual, pos_x, pos_y) VALUES (?, ?, ?, ?, ?) RETURNING id`,
      [antenaId, item.nome.replace('[DEMO] ', ''), item.visual, item.x, item.y]
    );
    ids.set(item.chave, { antena: antenaId, node: Number(node[0].id) });
  }

  const enlaces = [
    ['core', 'norte_tx', 'Backbone Norte / Saída', '5.8 GHz', 3.2, 850, null, false],
    ['norte_tx', 'norte_pop', 'PTP Torre Norte', '5.8 GHz', 11.8, 650, null, false],
    ['core', 'leste_tx', 'Backbone Leste / Saída', '5.65 GHz', 4.1, 850, null, false],
    ['leste_tx', 'leste_pop', 'PTP Torre Leste', '5.65 GHz', 14.6, 600, null, false],
    ['core', 'backup', 'Rota de contingência', '5.2 GHz', 6.4, 300, '#A78BFA', true],
    ['backup', 'remoto', 'PTP POP Sul', '5.2 GHz', 18.7, 250, '#A78BFA', true],
    ['norte_pop', 'backup', 'Anel Norte–Backup', '5.4 GHz', 9.3, 200, '#38BDF8', true],
    ['backup', 'leste_pop', 'Anel Backup–Leste', '5.4 GHz', 10.1, 200, '#38BDF8', true],
  ] as const;

  for (const [origem, destino, label, frequencia, distancia, capacidade, cor, curvo] of enlaces) {
    await pool.query(
      `INSERT INTO antenas_enlaces (origem_node_id, destino_node_id, tipo_enlace, label, frequencia, distancia_km, capacidade_mbps, cor, curvo)
       VALUES (?, ?, 'ptp_wireless', ?, ?, ?, ?, ?, ?)`,
      [ids.get(origem)!.node, ids.get(destino)!.node, label, frequencia, distancia, capacidade, cor, curvo]
    );
  }
  await pool.query(
    `INSERT INTO antenas_viewport (id, pos_x, pos_y, zoom) VALUES (1, 0, 0, 0.85)
     ON CONFLICT (id) DO UPDATE SET pos_x = 0, pos_y = 0, zoom = 0.85`
  );
  console.log(`Topologia DEMO criada: ${equipamentos.length} equipamentos e ${enlaces.length} enlaces.`);
}

withUserContext(ADMIN_ID, semear)
  .catch((erro) => { console.error('Erro ao criar topologia DEMO:', erro); process.exitCode = 1; })
  .finally(() => pool.end());
