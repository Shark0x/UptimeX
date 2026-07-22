import { pool } from '../db/pool';

/**
 * Configurações editáveis pela interface (tabela chave-valor `configuracoes`),
 * mantidas em cache na memória. Precedência: valor salvo pela UI vence; se
 * estiver vazio, cai no .env — assim quem já configurou por env continua valendo.
 */

const cache = new Map<string, string>();

export async function carregarConfig(): Promise<void> {
  try {
    const [rows]: any = await pool.query(`SELECT chave, valor FROM configuracoes`);
    cache.clear();
    for (const r of rows) if (r.valor != null) cache.set(r.chave, String(r.valor));
  } catch (err) {
    console.error('Falha ao carregar configuracoes do banco:', err);
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
    await pool.query(
      `INSERT INTO configuracoes (chave, valor) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE valor = VALUES(valor)`,
      [chave, valor]
    );
    if (valor && valor.trim() !== '') cache.set(chave, valor.trim());
    else cache.delete(chave);
  }
}
