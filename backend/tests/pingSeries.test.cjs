const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  PING_HISTORY_RANGES,
  normalizarRangeHistorico,
} = require('../dist/services/pingHistoryService.js');
const { classificarAmostraPing } = require('../dist/services/pingSeriesService.js');

test('seleciona raw, hourly e daily conforme o periodo solicitado', () => {
  assert.equal(PING_HISTORY_RANGES['24h'].source, 'raw');
  assert.equal(PING_HISTORY_RANGES['7d'].source, 'hourly');
  assert.equal(PING_HISTORY_RANGES['30d'].source, 'hourly');
  assert.equal(PING_HISTORY_RANGES['90d'].source, 'daily');
  assert.equal(PING_HISTORY_RANGES['1y'].source, 'daily');
  assert.equal(normalizarRangeHistorico(undefined), '24h');
  assert.equal(normalizarRangeHistorico('2y'), null);
});

test('classifica amostras online, degradadas e offline', () => {
  assert.equal(classificarAmostraPing(true, 20, 0), 'online');
  assert.equal(classificarAmostraPing(true, 500, 0), 'degraded');
  assert.equal(classificarAmostraPing(true, 20, 50), 'degraded');
  assert.equal(classificarAmostraPing(false, null, 100), 'offline');
});

test('migration possui indices cobrindo device/range e empresa/range', () => {
  const migration = fs.readFileSync(
    path.join(__dirname, '../src/db/migrations/20260820_ping_timeseries.sql'),
    'utf8'
  );
  for (const trecho of [
    'uq_ping_log_device_timestamp (device_id, timestamp)',
    'idx_ping_log_empresa_timestamp (empresa_id, timestamp)',
    'PRIMARY KEY (device_id, bucket_start)',
    'idx_ping_log_hourly_empresa_bucket (empresa_id, bucket_start)',
    'idx_ping_log_daily_empresa_bucket (empresa_id, bucket_start)',
  ]) {
    assert.match(migration, new RegExp(trecho.replace(/[()]/g, '\\$&')));
  }
});
