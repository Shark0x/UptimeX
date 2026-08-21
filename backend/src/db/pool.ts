import { Pool, PoolClient, types } from 'pg';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';
import dotenv from 'dotenv';

dotenv.config();

// --- Datas como string (replica o dateStrings:true do antigo mysql2) --------
// O frontend e varios pontos do backend tratam datas como string (ISO/"YYYY-MM-DD
// HH:MM:SS"). Sem estes parsers o pg devolveria objetos Date e mudaria o formato
// serializado nas respostas, quebrando telas que fazem new Date(string).
const manterString = (v: string | null) => v;
types.setTypeParser(1082, manterString); // date
types.setTypeParser(1083, manterString); // time
types.setTypeParser(1114, manterString); // timestamp
types.setTypeParser(1184, manterString); // timestamptz
types.setTypeParser(1266, manterString); // timetz
// int8/bigint (oid 20) permanece string; o codigo ja faz Number(...) onde precisa.

const host = process.env.PGHOST || process.env.DB_HOST || 'localhost';
const port = Number(process.env.PGPORT || process.env.DB_PORT) || 5432;
const database = process.env.PGDATABASE || process.env.POSTGRES_DB || 'uptimex';

// Pool da API HTTP: role uptimex_app (NOSUPERUSER, sujeita ao RLS por app.user_id).
export const appPool = new Pool({
  host,
  port,
  database,
  user: process.env.POSTGRES_APP_USER || 'uptimex_app',
  password: process.env.POSTGRES_APP_PASSWORD || '',
  max: Number(process.env.PG_APP_POOL_MAX) || 15,
  idleTimeoutMillis: 60_000,
  connectionTimeoutMillis: 10_000,
});

// Pool do motor de monitoramento: role uptimex_worker (policies USING(true),
// sem necessidade de app.user_id — escreve ping/status/metricas de todos).
export const workerPool = new Pool({
  host,
  port,
  database,
  user: process.env.POSTGRES_WORKER_USER || 'uptimex_worker',
  password: process.env.POSTGRES_WORKER_PASSWORD || '',
  max: Number(process.env.PG_WORKER_POOL_MAX) || 8,
  idleTimeoutMillis: 60_000,
  connectionTimeoutMillis: 10_000,
});

appPool.on('error', (err) => console.error('[pg appPool] cliente ocioso caiu:', err.message));
workerPool.on('error', (err) => console.error('[pg workerPool] cliente ocioso caiu:', err.message));

// --- Contexto RLS por requisicao (AsyncLocalStorage) ------------------------
// Toda requisicao autenticada roda numa transacao com o client vinculado aqui;
// as queries herdam esse client (e o app.user_id ja definido nele) via ALS.
interface RlsStore {
  client: PoolClient;
  // Mutex: o pg nao aceita queries concorrentes no mesmo client. Encadeamos as
  // chamadas para o caso de um handler disparar pool.query em paralelo.
  tail: Promise<unknown>;
}
const als = new AsyncLocalStorage<RlsStore>();

export interface QueryMeta {
  rowCount: number;
  command: string;
  fields: unknown[];
}
// Mantem a forma [rows, meta] do mysql2 para "const [rows] = await pool.query(...)".
export type QueryResultCompat = [any[], QueryMeta];

// mysql2 usa "?"; o pg usa "$1, $2, ...". O codigo nao usa "??" (escape de
// identificador do mysql2), entao a substituicao posicional simples e segura.
function traduzPlaceholders(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

function empacotar(res: { rows: any[]; rowCount: number | null; command: string; fields: any[] }): QueryResultCompat {
  return [res.rows, { rowCount: res.rowCount ?? 0, command: res.command, fields: res.fields }];
}

// Enfileira uma operacao no client vinculado, respeitando o mutex (store.tail).
function enfileirar<T>(store: RlsStore, fn: () => Promise<T>): Promise<T> {
  const run = store.tail.then(fn, fn);
  store.tail = run.then(() => undefined, () => undefined);
  return run;
}

async function consultar(sql: string, params: any[] = []): Promise<QueryResultCompat> {
  const text = traduzPlaceholders(sql);
  const store = als.getStore();
  if (store) {
    return enfileirar(store, async () => empacotar(await store.client.query(text, params)));
  }
  // Sem contexto RLS (login, health, tarefas sem usuario): conexao avulsa do appPool.
  return empacotar(await appPool.query(text, params));
}

// --- Compat de transacao explicita (pool.getConnection do mysql2) -----------
export interface ConexaoCompat {
  query(sql: string, params?: any[]): Promise<QueryResultCompat>;
  beginTransaction(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  release(): void;
}

let savepointSeq = 0;

async function getConnection(): Promise<ConexaoCompat> {
  const store = als.getStore();
  if (store) {
    // Dentro de uma requisicao autenticada ja existe transacao + app.user_id.
    // Mapeamos a "transacao" do chamador para um SAVEPOINT no client vinculado,
    // preservando a semantica de rollback parcial sem abrir uma 2a conexao (que
    // nao teria contexto RLS).
    const sp = `sp_${++savepointSeq}`;
    let aberto = false;
    return {
      query: (sql, params = []) =>
        enfileirar(store, async () => empacotar(await store.client.query(traduzPlaceholders(sql), params))),
      beginTransaction: async () => {
        await enfileirar(store, () => store.client.query(`SAVEPOINT ${sp}`));
        aberto = true;
      },
      commit: async () => {
        if (aberto) await enfileirar(store, () => store.client.query(`RELEASE SAVEPOINT ${sp}`));
        aberto = false;
      },
      rollback: async () => {
        if (aberto) await enfileirar(store, () => store.client.query(`ROLLBACK TO SAVEPOINT ${sp}`));
        aberto = false;
      },
      // O client pertence a requisicao (sera liberado no fim dela); nao liberar aqui.
      release: () => undefined,
    };
  }
  // Fora de contexto RLS: transacao real numa conexao dedicada do appPool.
  const client = await appPool.connect();
  return {
    query: async (sql, params = []) => empacotar(await client.query(traduzPlaceholders(sql), params)),
    beginTransaction: () => client.query('BEGIN').then(() => undefined),
    commit: () => client.query('COMMIT').then(() => undefined),
    rollback: () => client.query('ROLLBACK').then(() => undefined),
    release: () => client.release(),
  };
}

// Objeto exportado com a mesma superficie usada pelo codigo (pool.query /
// pool.getConnection / pool.end para scripts standalone).
export const pool = { query: consultar, getConnection, end: encerrarPools };

// --- Wrappers de contexto RLS ----------------------------------------------
/**
 * Executa `fn` dentro de uma transacao com `app.user_id` definido. Base p/ fluxos
 * fora do ciclo HTTP que precisam de contexto: login (criar sessao), sockets,
 * tarefas. Faz COMMIT no sucesso e ROLLBACK no erro.
 */
export async function withUserContext<T>(userId: number, fn: () => Promise<T>): Promise<T> {
  const client = await appPool.connect();
  const store: RlsStore = { client, tail: Promise.resolve() };
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.user_id', String(userId)]);
    const resultado = await als.run(store, async () => {
      const r = await fn();
      await store.tail.catch(() => undefined);
      return r;
    });
    await client.query('COMMIT');
    return resultado;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* transacao ja abortada */
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Middleware-helper: abre a transacao RLS da requisicao e a mantem aberta ate a
 * resposta terminar. COMMIT em 2xx/3xx; ROLLBACK em >=400 ou conexao abortada.
 * (Trade-off conhecido: o COMMIT ocorre no evento 'finish', logo depois do envio
 * da resposta — aceitavel para a escala interna; as escritas do handler ja foram
 * aguardadas antes do res.json.)
 */
export async function comContextoRls(
  userId: number,
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  let client: PoolClient;
  try {
    client = await appPool.connect();
  } catch (err) {
    return next(err as Error);
  }
  const store: RlsStore = { client, tail: Promise.resolve() };
  let finalizado = false;
  const finalizar = (commit: boolean) => {
    if (finalizado) return;
    finalizado = true;
    store.tail
      .catch(() => undefined)
      .then(() => client.query(commit ? 'COMMIT' : 'ROLLBACK'))
      .catch((err) => console.error('[rls] falha ao finalizar transacao:', err.message))
      .finally(() => client.release());
  };
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.user_id', String(userId)]);
  } catch (err) {
    client.release();
    return next(err as Error);
  }
  res.on('finish', () => finalizar(res.statusCode < 400));
  res.on('close', () => finalizar(false));
  als.run(store, () => next());
}

// --- Motor de monitoramento (role worker) -----------------------------------
export async function workerQuery(sql: string, params: any[] = []): Promise<QueryResultCompat> {
  return empacotar(await workerPool.query(traduzPlaceholders(sql), params));
}

export async function encerrarPools(): Promise<void> {
  await Promise.allSettled([appPool.end(), workerPool.end()]);
}
