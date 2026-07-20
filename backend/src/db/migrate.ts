import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { hashPassword } from '../services/authService';
dotenv.config();

async function semearAdminInicial(connection: mysql.Connection) {
  const [rows]: any = await connection.query(`SELECT COUNT(*) as total FROM usuarios`);
  if (rows[0].total > 0) return;

  const senha = process.env.SEED_ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  const hash = await hashPassword(senha);
  await connection.query(
    `INSERT INTO usuarios (username, senha_hash, role) VALUES ('admin', ?, 'admin')`,
    [hash]
  );

  console.log('');
  console.log('==================================================================');
  console.log(' CONTA ADMIN INICIAL CRIADA');
  console.log(` usuário: admin`);
  console.log(` senha:   ${senha}`);
  console.log(' Anote agora — esta senha não será mostrada de novo. Troque-a após o primeiro login.');
  console.log('==================================================================');
  console.log('');
}

async function migrate() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true,
  });

  const dbName = process.env.DB_NAME || 'netmonitor';
  await connection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\``);
  await connection.query(`USE \`${dbName}\``);

  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
  await connection.query(schema);

  await semearAdminInicial(connection);

  console.log(`Banco "${dbName}" migrado com sucesso.`);
  await connection.end();
}

migrate().catch((err) => {
  console.error('Erro ao migrar banco:', err);
  process.exit(1);
});
