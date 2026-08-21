import mysql from 'mysql2/promise';
import pg from 'pg';

const { Client } = pg;
const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} nao definido`);
  return value;
};

const mysqlConfig = {
  host: required('MYSQL_HOST'), port: Number(process.env.MYSQL_PORT || 3306),
  user: required('MYSQL_USER'), password: required('MYSQL_PASSWORD'),
  database: required('MYSQL_DATABASE'), dateStrings: true,
};
const postgresConfig = {
  host: required('POSTGRES_HOST'), port: Number(process.env.POSTGRES_PORT || 5432),
  user: required('POSTGRES_USER'), password: required('POSTGRES_PASSWORD'),
  database: required('POSTGRES_DB'),
};

const quote = (name) => `"${name.replaceAll('"', '""')}"`;

async function mysqlTableExists(db, table) {
  const [rows] = await db.query(
    `SELECT COUNT(*) AS total FROM information_schema.tables WHERE table_schema = ? AND table_name = ?`,
    [mysqlConfig.database, table]
  );
  return Number(rows[0].total) > 0;
}

async function read(db, table, columns = '*') {
  if (!(await mysqlTableExists(db, table))) return [];
  const [rows] = await db.query(`SELECT ${columns} FROM \`${table}\``);
  return rows;
}

async function insertRows(client, table, rows, columns) {
  if (!rows.length) return;
  // Dumps antigos podem não ter colunas adicionadas depois (por exemplo,
  // usuarios.sessao_versao). Omita essas colunas para o PostgreSQL aplicar o
  // DEFAULT do schema, em vez de inserir NULL numa coluna NOT NULL.
  const availableColumns = columns.filter((column) => Object.hasOwn(rows[0], column));
  const missingColumns = columns.filter((column) => !Object.hasOwn(rows[0], column));
  if (!availableColumns.length) {
    throw new Error(`${table}: nenhuma coluna compatível encontrada no MySQL`);
  }
  if (missingColumns.length) {
    console.log(`${table}: coluna(s) ausente(s) no dump antigo; usando defaults: ${missingColumns.join(', ')}`);
  }
  const names = availableColumns.map(quote).join(', ');
  const batchSize = 500;
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize);
    const values = [];
    const tuples = batch.map((row, rowIndex) => {
      const placeholders = availableColumns.map((column, columnIndex) => {
        values.push(row[column] ?? null);
        return `$${rowIndex * availableColumns.length + columnIndex + 1}`;
      });
      return `(${placeholders.join(', ')})`;
    });
    await client.query(`INSERT INTO ${quote(table)} (${names}) VALUES ${tuples.join(', ')}`, values);
    const processed = offset + batch.length;
    if (processed === rows.length || processed % 100000 === 0) {
      console.log(`${table}: ${processed}/${rows.length} registro(s)`);
    }
  }
}

async function resetIdentity(client, table) {
  await client.query(`
    SELECT setval(
      pg_get_serial_sequence($1, 'id'),
      COALESCE((SELECT MAX(id) FROM ${quote(table)}), 1),
      EXISTS (SELECT 1 FROM ${quote(table)})
    )`, [table]);
}

const specs = [
  ['usuarios', ['id','username','senha_hash','role','ativo','sessao_versao','criado_em']],
  ['empresas', ['id','nome','descricao','foto_url','endereco','latitude','longitude','criado_em']],
  ['usuario_empresas', ['usuario_id','empresa_id','ativo','criado_em']],
  ['dispositivos', ['id','empresa_id','nome','ip','fabricante','metodo_monitoramento','comunidade_snmp','porta_snmp','intervalo_polling_seg','status_atual','ultima_verificacao','latencia_ms','perda_pct','ativo','criado_em']],
  ['ping_metricas', ['id','dispositivo_id','latencia_ms','perda_pct','timestamp']],
  ['status_eventos', ['id','dispositivo_id','status','inicio','fim','duracao_segundos']],
  ['topologia_nodes', ['id','empresa_id','dispositivo_id','label','tipo','pos_x','pos_y']],
  ['topologia_viewport', ['empresa_id','pos_x','pos_y','zoom']],
  ['topologia_edges', ['id','empresa_id','node_origem','node_destino','label']],
  ['links_dedicados', ['id','empresa_id','bloco','descricao','criado_em']],
  ['configuracoes', ['chave','valor']],
  ['auditoria', ['id','usuario_id','empresa_id','usuario','acao','entidade','entidade_id','detalhes','ip_origem','pais','regiao','cidade','timestamp']],
];

const identityTables = [
  'usuarios','empresas','dispositivos','ping_metricas','status_eventos','topologia_nodes',
  'topologia_edges','links_dedicados','auditoria','antenas',
  'antenas_nodes','antenas_enlaces','antenas_metricas',
];

async function migrateAntennas(mysqlDb, client) {
  // Board GLOBAL do provedor (sem empresa_id): migra 1:1 as tabelas antenas*.
  const antennas = await read(mysqlDb, 'antenas');
  await insertRows(client, 'antenas', antennas,
    ['id','nome','ip','fabricante','modelo','tipo_wireless','frequencia_mhz','largura_canal_mhz','ssid','sinal_esperado_dbm','intervalo_polling_seg','status_atual','latencia_ms','perda_pct','ultima_verificacao','ativo','criado_em']);

  const nodes = await read(mysqlDb, 'antenas_nodes');
  await insertRows(client, 'antenas_nodes', nodes,
    ['id','antena_id','label','tipo_visual','pos_x','pos_y','criado_em']);

  const edges = await read(mysqlDb, 'antenas_enlaces');
  await insertRows(client, 'antenas_enlaces', edges,
    ['id','origem_node_id','destino_node_id','tipo_enlace','label','frequencia','distancia_km','capacidade_mbps','cor','curvo','espessura','estilo','animado','criado_em']);

  const metrics = await read(mysqlDb, 'antenas_metricas');
  await insertRows(client, 'antenas_metricas', metrics,
    ['id','antena_id','latencia_ms','perda_pct','timestamp']);

  // Board unico: forca id = 1 (a versao antiga por empresa nao tinha essa coluna).
  const viewports = await read(mysqlDb, 'antenas_viewport');
  if (viewports.length) {
    await insertRows(client, 'antenas_viewport', [{ ...viewports[0], id: 1 }],
      ['id','pos_x','pos_y','zoom']);
  }
}

async function main() {
  const mysqlDb = await mysql.createConnection(mysqlConfig);
  const client = new Client(postgresConfig);
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(`TRUNCATE TABLE
      antenas_metricas, antenas_enlaces, antenas_nodes,
      antenas_viewport, antenas, auditoria, configuracoes,
      links_dedicados, topologia_edges, topologia_viewport, topologia_nodes,
      status_eventos, ping_metricas, dispositivos, usuario_empresas, empresas, usuarios
      RESTART IDENTITY CASCADE`);

    for (const [table, columns] of specs) {
      const rows = await read(mysqlDb, table);
      await insertRows(client, table, rows, columns);
    }

    // Vincula o usuario da auditoria quando o nome ainda corresponde a uma conta.
    await client.query(`UPDATE auditoria a SET usuario_id = u.id FROM usuarios u WHERE a.usuario_id IS NULL AND u.username = a.usuario`);
    // Administradores globais recebem todas as empresas; visualizadores ficam sem
    // acesso ate o administrador definir explicitamente suas empresas.
    await client.query(`INSERT INTO usuario_empresas (usuario_id, empresa_id, ativo)
      SELECT u.id, e.id, true FROM usuarios u CROSS JOIN empresas e WHERE u.role = 'admin' AND u.ativo
      ON CONFLICT (usuario_id, empresa_id) DO UPDATE SET ativo = true`);

    await migrateAntennas(mysqlDb, client);
    for (const table of identityTables) await resetIdentity(client, table);

    await client.query('COMMIT');
    console.log('Migracao concluida em uma unica transacao. MySQL nao foi alterado.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await mysqlDb.end();
    await client.end();
  }
}

main().catch((error) => {
  console.error('Falha na migracao; PostgreSQL revertido:', error);
  process.exit(1);
});
