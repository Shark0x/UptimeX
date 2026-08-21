import { pool, workerQuery } from '../db/pool';
import {
  chaveCriptografiaConfigurada,
  criptografarSegredo,
  descriptografarSegredo,
  segredoEstaCifrado,
} from '../security/secretCrypto';

/**
 * Configurações editáveis pela interface (tabela chave-valor `configuracoes`),
 * mantidas em cache na memória. Precedência: valor salvo pela UI vence; se
 * estiver vazio, cai no .env — assim quem já configurou por env continua valendo.
 */

const cache = new Map<string, string>();
const CHAVES_SECRETAS = new Set(['telegram_bot_token']);

export async function carregarConfig(): Promise<void> {
  try {
    // Boot (sem contexto HTTP): roda como worker, que tem SELECT/UPDATE em configuracoes.
    const [rows]: any = await workerQuery(`SELECT chave, valor FROM configuracoes`);
    cache.clear();
    for (const r of rows) {
      if (r.valor == null) continue;
      const armazenado = String(r.valor);
      const valor = CHAVES_SECRETAS.has(r.chave) ? descriptografarSegredo(armazenado) : armazenado;
      cache.set(r.chave, valor);
      if (CHAVES_SECRETAS.has(r.chave) && armazenado && !segredoEstaCifrado(armazenado) && chaveCriptografiaConfigurada()) {
        await workerQuery(`UPDATE configuracoes SET valor = ? WHERE chave = ?`, [criptografarSegredo(armazenado), r.chave]);
      }
    }
  } catch {
    console.error('Falha ao carregar configuracoes do banco.');
  }
}

export function obterConfig(chave: string, envFallback?: string): string {
  const v = cache.get(chave);
  if (v && v.trim() !== '') return v.trim();
  if (envFallback) return process.env[envFallback]?.trim() || '';
  return '';
}

/** Upsert das entradas informadas (só as chaves passadas são tocadas). */
export async function salvarConfig(entradas: Record<string, string>): Promise<void> {
  for (const [chave, valor] of Object.entries(entradas)) {
    const valorPersistido = CHAVES_SECRETAS.has(chave) && valor ? criptografarSegredo(valor) : valor;
    await pool.query(
      `INSERT INTO configuracoes (chave, valor) VALUES (?, ?)
       ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor`,
      [chave, valorPersistido]
    );
    if (valor && valor.trim() !== '') cache.set(chave, valor.trim());
    else cache.delete(chave);
  }
}
