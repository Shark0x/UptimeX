const test = require('node:test');
const assert = require('node:assert/strict');
const {
  filtroEmpresaSql,
  normalizarIdPositivo,
  podeAcessarEmpresa,
  podeOperarTenant,
} = require('../dist/security/tenantAccess.js');

test('admin possui bypass global explicito', () => {
  const admin = { role: 'admin', empresaIds: [] };
  assert.equal(podeAcessarEmpresa(admin, 999), true);
  assert.deepEqual(filtroEmpresaSql(admin, 'e.id'), { sql: '1 = 1', params: [] });
});

test('perfis internos acessam todas as empresas', () => {
  const operador = { role: 'operador', empresaIds: [2, 7] };
  const visualizador = { role: 'visualizador', empresaIds: [3] };

  assert.equal(podeAcessarEmpresa(operador, 2), true);
  assert.equal(podeAcessarEmpresa(operador, 3), true);
  assert.equal(podeAcessarEmpresa(visualizador, 3), true);
  assert.equal(podeAcessarEmpresa(visualizador, 2), true);
  assert.deepEqual(filtroEmpresaSql(operador, 'd.empresa_id'), {
    sql: '1 = 1',
    params: [],
  });
});

test('perfil interno sem vinculos mantem acesso global', () => {
  const usuario = { role: 'visualizador', empresaIds: [] };
  assert.equal(podeAcessarEmpresa(usuario, 1), true);
  assert.deepEqual(filtroEmpresaSql(usuario, 'empresa_id'), { sql: '1 = 1', params: [] });
});

test('somente admin e operador podem escrever em recursos tenant', () => {
  assert.equal(podeOperarTenant({ role: 'admin', empresaIds: [] }), true);
  assert.equal(podeOperarTenant({ role: 'operador', empresaIds: [1] }), true);
  assert.equal(podeOperarTenant({ role: 'visualizador', empresaIds: [1] }), false);
});

test('IDs externos precisam ser inteiros positivos', () => {
  assert.equal(normalizarIdPositivo('42'), 42);
  assert.equal(normalizarIdPositivo(0), null);
  assert.equal(normalizarIdPositivo('-1'), null);
  assert.equal(normalizarIdPositivo('1.5'), null);
  assert.equal(normalizarIdPositivo('abc'), null);
});
