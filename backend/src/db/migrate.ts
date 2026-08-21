import fs from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { hashPassword } from '../services/authService';
dotenv.config();

async function semearAdminInicial(connection: mysql.Connection) {
  const [rows]: any = await connection.query(`SELECT COUNT(*) as total FROM usuarios`);
  if (rows[0].total > 0) return;

  const senha = process.env.SEED_ADMIN_PASSWORD;
  if (!senha || senha.length < 12 || !/[a-z]/.test(senha) || !/[A-Z]/.test(senha) || !/[0-9]/.test(senha)) {
    throw new Error('SEED_ADMIN_PASSWORD deve ter 12+ caracteres, maiuscula, minuscula e numero.');
  }
  const hash = await hashPassword(senha);
  await connection.query(
    `INSERT INTO usuarios (username, senha_hash, role) VALUES ('admin', ?, 'admin')`,
    [hash]
  );

  console.log('Conta admin inicial criada. A senha veio de SEED_ADMIN_PASSWORD e nao foi exibida.');
}

async function migrate() {
  const dbName = process.env.DB_NAME || 'netmonitor';
  if (!/^[A-Za-z0-9_]+$/.test(dbName)) throw new Error('DB_NAME invalido.');
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_MIGRATION_USER || process.env.DB_USER || 'root',
    password: process.env.DB_MIGRATION_PASSWORD || process.env.DB_PASSWORD || '',
    multipleStatements: true,
  });

  await connection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\``);
  await connection.query(`USE \`${dbName}\``);

  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
  await connection.query(schema);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(190) NOT NULL PRIMARY KEY,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB
  `);

  const migrationsDir = path.join(__dirname, 'migrations');
  if (fs.existsSync(migrationsDir)) {
    const migrations = fs.readdirSync(migrationsDir)
      .filter((arquivo) => arquivo.endsWith('.sql'))
      .sort();

    for (const version of migrations) {
      const [aplicadas]: any = await connection.query(
        `SELECT 1 FROM schema_migrations WHERE version = ? LIMIT 1`,
        [version]
      );
      if (aplicadas.length > 0) continue;

      const sql = fs.readFileSync(path.join(migrationsDir, version), 'utf-8');
      await connection.query(sql);
      await connection.query(
        `INSERT INTO schema_migrations (version) VALUES (?)`,
        [version]
      );
      console.log(`Migration aplicada: ${version}`);
    }
  }

  await semearAdminInicial(connection);

  const appUser = process.env.DB_USER || '';
  const appPassword = process.env.DB_PASSWORD || '';
  const migrationUser = process.env.DB_MIGRATION_USER || appUser;
  if (appUser && appUser !== migrationUser) {
    if (!/^[A-Za-z0-9_]+$/.test(appUser) || appPassword.length < 16) {
      throw new Error('DB_USER deve ser alfanumerico e DB_PASSWORD deve ter ao menos 16 caracteres.');
    }
    const senhaSql = connection.escape(appPassword);
    await connection.query(`CREATE USER IF NOT EXISTS '${appUser}'@'%' IDENTIFIED BY ${senhaSql}`);
    await connection.query(`ALTER USER '${appUser}'@'%' IDENTIFIED BY ${senhaSql}`);
    await connection.query(`REVOKE ALL PRIVILEGES, GRANT OPTION FROM '${appUser}'@'%'`);
    await connection.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON \`${dbName}\`.* TO '${appUser}'@'%'`);
  }

  console.log(`Banco "${dbName}" migrado com sucesso.`);
  await connection.end();
}

migrate().catch((err) => {
  console.error('Erro ao migrar banco:', err);
  process.exit(1);
});
