const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  validarDestinoMonitoramento,
  portaSnmpPermitida,
} = require('../dist/security/monitorTarget.js');
const {
  criptografarSegredo,
  descriptografarSegredo,
} = require('../dist/security/secretCrypto.js');

test('bloqueia alvos locais e exige allowlist para rede privada', () => {
  const anterior = process.env.MONITOR_ALLOWED_CIDRS;
  delete process.env.MONITOR_ALLOWED_CIDRS;
  assert.equal(validarDestinoMonitoramento('1.1.1.1').ok, true);
  assert.equal(validarDestinoMonitoramento('127.0.0.1').ok, false);
  assert.equal(validarDestinoMonitoramento('169.254.169.254').ok, false);
  assert.equal(validarDestinoMonitoramento('::ffff:127.0.0.1').ok, false);
  assert.equal(validarDestinoMonitoramento('64:ff9b::7f00:1').ok, false);
  assert.equal(validarDestinoMonitoramento('10.20.1.5').ok, false);
  process.env.MONITOR_ALLOWED_CIDRS = '10.20.0.0/16';
  assert.equal(validarDestinoMonitoramento('10.20.1.5').ok, true);
  assert.equal(validarDestinoMonitoramento('1.1.1.1').ok, false);
  if (anterior === undefined) delete process.env.MONITOR_ALLOWED_CIDRS;
  else process.env.MONITOR_ALLOWED_CIDRS = anterior;
});

test('restringe portas SNMP a lista operacional', () => {
  const anterior = process.env.SNMP_ALLOWED_PORTS;
  process.env.SNMP_ALLOWED_PORTS = '161,1161';
  assert.equal(portaSnmpPermitida(161), true);
  assert.equal(portaSnmpPermitida(1161), true);
  assert.equal(portaSnmpPermitida(22), false);
  if (anterior === undefined) delete process.env.SNMP_ALLOWED_PORTS;
  else process.env.SNMP_ALLOWED_PORTS = anterior;
});

test('cifra segredos com AES-GCM e mantem leitura legada durante migracao', () => {
  const anterior = process.env.DATA_ENCRYPTION_KEY;
  process.env.DATA_ENCRYPTION_KEY = 'teste-seguranca-chave-com-mais-de-32-caracteres';
  const cifrado = criptografarSegredo('comunidade-super-secreta');
  assert.match(cifrado, /^enc:v1:/);
  assert.equal(cifrado.includes('comunidade-super-secreta'), false);
  assert.equal(descriptografarSegredo(cifrado), 'comunidade-super-secreta');
  assert.equal(descriptografarSegredo('legado'), 'legado');
  if (anterior === undefined) delete process.env.DATA_ENCRYPTION_KEY;
  else process.env.DATA_ENCRYPTION_KEY = anterior;
});

test('respostas de dispositivos nao selecionam a comunidade SNMP', () => {
  const rota = fs.readFileSync(path.join(__dirname, '../src/routes/dispositivos.ts'), 'utf8');
  assert.doesNotMatch(rota, /SELECT \* FROM dispositivos WHERE empresa_id/);
  assert.match(rota, /comunidade_snmp_configurada/);
  const migration = fs.readFileSync(path.join(__dirname, '../src/db/migrations/20260820_security_mcp_keys.sql'), 'utf8');
  assert.match(migration, /token_hash CHAR\(64\)/);
  assert.match(migration, /DELETE FROM configuracoes WHERE chave = 'mcp_api_key'/);
});
