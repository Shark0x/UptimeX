import dotenv from 'dotenv';
import { hashPassword } from '../services/authService';
import { appPool, encerrarPools } from './pool';

dotenv.config();

// Bootstrap do Postgres: o schema, as roles e as policies RLS sao criados pelo
// proprio container (postgres/init/* roda no initdb). Aqui so esperamos o banco
// aceitar conexoes e semeamos o admin inicial. Nada de DDL.
const SEED_USERNAME = process.env.SEED_ADMIN_USERNAME || 'admin';

function validarSenha(senha: string | undefined): string {
  if (!senha || senha.length < 12 || !/[a-z]/.test(senha) || !/[A-Z]/.test(senha) || !/[0-9]/.test(senha)) {
    throw new Error('SEED_ADMIN_PASSWORD deve ter 12+ caracteres, com maiuscula, minuscula e numero.');
  }
  return senha;
}

async function esperarBanco(tentativas = 30, intervaloMs = 2000): Promise<void> {
  for (let i = 1; i <= tentativas; i++) {
    try {
      await appPool.query('SELECT 1');
      return;
    } catch (err: any) {
      console.log(`[bootstrap] aguardando PostgreSQL (${i}/${tentativas})... ${err.code || err.message}`);
      await new Promise((r) => setTimeout(r, intervaloMs));
    }
  }
  throw new Error('PostgreSQL nao respondeu a tempo.');
}

async function bootstrap(): Promise<void> {
  await esperarBanco();

  const senha = validarSenha(process.env.SEED_ADMIN_PASSWORD);
  const hash = await hashPassword(senha);

  // auth_seed_admin (SECURITY DEFINER) insere o admin apenas se ainda nao houver
  // admin ativo; devolve o id novo ou NULL quando ja existe. Bypassa o RLS por ser
  // SECURITY DEFINER, resolvendo o chicken-and-egg (nao ha usuario/contexto ainda).
  const { rows } = await appPool.query('SELECT auth_seed_admin($1, $2, $3) AS id', [
    SEED_USERNAME,
    hash,
    'admin',
  ]);
  const novoId = rows[0]?.id;
  if (novoId) {
    console.log(
      `[bootstrap] conta admin inicial "${SEED_USERNAME}" criada (id ${novoId}). ` +
      'A senha veio de SEED_ADMIN_PASSWORD e nao foi exibida.'
    );
  } else {
    console.log('[bootstrap] admin ja existente; nada a semear.');
  }
}

bootstrap()
  .then(() => encerrarPools())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error('[bootstrap] falha:', err?.message || err);
    await encerrarPools().catch(() => undefined);
    process.exit(1);
  });
