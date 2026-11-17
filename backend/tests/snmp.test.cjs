const test = require('node:test');
const assert = require('node:assert/strict');

const {
  calcularDeltaContador,
  octetosParaBps,
  deltaParaTaxaPorSegundo,
  paraBigInt,
  formatarBps,
  MAX_COUNTER32,
} = require('../dist/services/snmp/counters.js');
const { indiceDoOid, capacidadeBps, rotuloStatusInterface, interfaceOperacional, COL, OID, HR_STORAGE_TYPE } =
  require('../dist/services/snmp/mib.js');
const { montarInterfaces, calcularAmostraInterface, extrairMetricasRecursos } = require('../dist/services/snmp/collector.js');
const { criarLimitadorConcorrencia, criarMutexPorChave } = require('../dist/services/concurrency.js');

const base = { valor: 0n, tempoMs: 0, uptimeTicks: 1000 };

test('delta: primeira leitura (sem anterior) é descartada', () => {
  const r = calcularDeltaContador(null, { valor: 100n, tempoMs: 1000, uptimeTicks: 1000 }, { largura: 64 });
  assert.equal(r.descartado, true);
  assert.equal(r.motivo, 'sem_anterior');
});

test('delta: cálculo normal de bps', () => {
  const ant = { valor: 0n, tempoMs: 0, uptimeTicks: 1000 };
  const atual = { valor: 1_000_000n, tempoMs: 1000, uptimeTicks: 1100 };
  const r = calcularDeltaContador(ant, atual, { largura: 64 });
  assert.equal(r.descartado, false);
  assert.equal(r.delta, 1_000_000);
  assert.equal(r.segundos, 1);
  assert.equal(octetosParaBps(r.delta, r.segundos), 8_000_000); // 1 MB/s = 8 Mbps
});

test('delta: estorno (wrap) de 32 bits é corrigido', () => {
  const ant = { valor: MAX_COUNTER32 - 100n, tempoMs: 0, uptimeTicks: 1000 };
  const atual = { valor: 50n, tempoMs: 1000, uptimeTicks: 1100 };
  const r = calcularDeltaContador(ant, atual, { largura: 32 });
  assert.equal(r.descartado, false);
  assert.equal(r.delta, 150); // 100 até o teto + 50 depois
});

test('delta: retrocesso em 64 bits é anomalia (descartado)', () => {
  const ant = { valor: 1000n, tempoMs: 0, uptimeTicks: 1000 };
  const atual = { valor: 500n, tempoMs: 1000, uptimeTicks: 1100 };
  const r = calcularDeltaContador(ant, atual, { largura: 64 });
  assert.equal(r.descartado, true);
  assert.equal(r.motivo, 'retrocesso');
});

test('delta: reinício do equipamento (sysUpTime recuou) é descartado', () => {
  const ant = { valor: 1000n, tempoMs: 0, uptimeTicks: 100000 };
  const atual = { valor: 20n, tempoMs: 30000, uptimeTicks: 500 };
  const r = calcularDeltaContador(ant, atual, { largura: 64 });
  assert.equal(r.descartado, true);
  assert.equal(r.motivo, 'reinicio');
});

test('delta: intervalo não-positivo e intervalo excessivo são descartados', () => {
  const ant = { valor: 0n, tempoMs: 1000, uptimeTicks: 1000 };
  assert.equal(calcularDeltaContador(ant, { valor: 5n, tempoMs: 1000, uptimeTicks: 1000 }, { largura: 64 }).motivo, 'intervalo_invalido');
  assert.equal(
    calcularDeltaContador(ant, { valor: 5n, tempoMs: 1000 + 7_200_000, uptimeTicks: 2000 }, { largura: 64 }).motivo,
    'intervalo_excessivo'
  );
});

test('taxa de pacotes (pps) e paraBigInt (Buffer/number/string)', () => {
  assert.equal(deltaParaTaxaPorSegundo(120, 60), 2);
  assert.equal(paraBigInt(42), 42n);
  assert.equal(paraBigInt('18446744073709551615'), 2n ** 64n - 1n);
  // Counter64 como Buffer big-endian de 8 bytes = 2^32
  assert.equal(paraBigInt(Buffer.from([0, 0, 0, 1, 0, 0, 0, 0])), 2n ** 32n);
});

test('formatarBps escolhe a unidade', () => {
  assert.match(formatarBps(2_100_000_000), /Gbps/);
  assert.match(formatarBps(150_000_000), /Mbps/);
  assert.match(formatarBps(0), /bps/);
});

test('mib: índice do OID, capacidade e rótulo de status', () => {
  assert.equal(indiceDoOid('1.3.6.1.2.1.2.2.1.10.7', '1.3.6.1.2.1.2.2.1.10'), 7);
  assert.equal(indiceDoOid('1.3.6.1.2.1.2.2.1.10', '1.3.6.1.2.1.2.2.1.10'), null);
  assert.equal(capacidadeBps(1000, null), 1_000_000_000); // ifHighSpeed 1000 Mbps = 1 Gbps
  assert.equal(capacidadeBps(null, 100000000), 100000000); // fallback ifSpeed
  assert.equal(rotuloStatusInterface(1), 'up');
  assert.equal(interfaceOperacional(1), true);
  assert.equal(interfaceOperacional(2), false);
});

test('montarInterfaces prefere contadores HC (64 bits)', () => {
  const vb = (value, type = 2) => ({ oid: 'x', type, value });
  const colunas = new Map();
  colunas.set(COL.ifName, new Map([[1, vb('eth0', 4)]]));
  colunas.set(COL.ifOperStatus, new Map([[1, vb(1)]]));
  colunas.set(COL.ifHighSpeed, new Map([[1, vb(1000)]]));
  colunas.set(COL.ifHCInOctets, new Map([[1, vb(5_000_000_000)]]));
  colunas.set(COL.ifInOctets, new Map([[1, vb(123)]]));
  const ifaces = montarInterfaces(colunas);
  assert.equal(ifaces.length, 1);
  assert.equal(ifaces[0].ifIndex, 1);
  assert.equal(ifaces[0].larguraOctetos, 64);
  assert.equal(ifaces[0].inOctets, 5_000_000_000n); // HC, não o de 32 bits
  assert.equal(ifaces[0].capacidadeBps, 1_000_000_000);
});

test('calcularAmostraInterface deriva bps da leitura anterior', () => {
  const iface = {
    ifIndex: 1, larguraOctetos: 64,
    inOctets: 10_000_000n, outOctets: 2_000_000n,
    inErrors: null, outErrors: null, inDiscards: null, outDiscards: null,
  };
  const anterior = {
    inOctets: 9_000_000n, outOctets: 1_000_000n,
    inErrors: null, outErrors: null, inDiscards: null, outDiscards: null,
    tempoMs: 0, uptimeTicks: 1000,
  };
  const a = calcularAmostraInterface(iface, anterior, 1100, 1000); // dt = 1s
  assert.equal(a.inBps, 8_000_000); // 1 MB * 8
  assert.equal(a.outBps, 8_000_000);
  assert.equal(a.inErrPps, null); // sem contador → null
});

test('extrairMetricasRecursos: calcula CPU de múltiplos núcleos via hrProcessorLoad', () => {
  const vb = (value, type = 2) => ({ oid: 'x', type, value });
  const colunas = new Map();
  colunas.set(
    COL.hrProcessorLoad,
    new Map([
      [1, vb(10)],
      [2, vb(20)],
      [3, vb(30)],
      [4, vb(40)],
    ])
  );
  const escalares = new Map();
  const rec = extrairMetricasRecursos(colunas, escalares);
  assert.equal(rec.cpuCores, 4);
  assert.equal(rec.cpuPct, 25.0);
});

test('extrairMetricasRecursos: extrai RAM e Disco de servidor via hrStorageTable', () => {
  const vb = (value, type = 2) => ({ oid: 'x', type, value });
  const colunas = new Map();
  // RAM (índice 1)
  // Disco (índice 2)
  colunas.set(
    COL.hrStorageType,
    new Map([
      [1, vb(HR_STORAGE_TYPE.ram)],
      [2, vb(HR_STORAGE_TYPE.fixedDisk)],
    ])
  );
  colunas.set(
    COL.hrStorageDescr,
    new Map([
      [1, vb('Physical memory')],
      [2, vb('/')],
    ])
  );
  colunas.set(
    COL.hrStorageAllocationUnits,
    new Map([
      [1, vb(1024)],
      [2, vb(4096)],
    ])
  );
  colunas.set(
    COL.hrStorageSize,
    new Map([
      [1, vb(16_777_216)], // 16 GB RAM
      [2, vb(25_000_000)], // ~100 GB Disco
    ])
  );
  colunas.set(
    COL.hrStorageUsed,
    new Map([
      [1, vb(8_388_608)], // 8 GB RAM usada
      [2, vb(10_000_000)], // ~40 GB Disco usado
    ])
  );
  const escalares = new Map();
  const rec = extrairMetricasRecursos(colunas, escalares);
  assert.equal(rec.memoriaTotalBytes, 16_777_216 * 1024);
  assert.equal(rec.memoriaUsoBytes, 8_388_608 * 1024);
  assert.equal(rec.memoriaPct, 50.0);
  assert.equal(rec.discoTotalBytes, 25_000_000 * 4096);
  assert.equal(rec.discoUsoBytes, 10_000_000 * 4096);
  assert.equal(rec.discoPct, 40.0);
});

test('extrairMetricasRecursos: usa fallbacks UCD-SNMP quando HOST-RESOURCES ausente', () => {
  const vb = (value, type = 2) => ({ oid: 'x', type, value });
  const colunas = new Map();
  const escalares = new Map();
  escalares.set(OID.ssCpuIdle, vb(75)); // 75% idle => 25% CPU
  escalares.set(OID.memTotalReal, vb(8_388_608)); // 8 GB em kB
  escalares.set(OID.memAvailReal, vb(4_194_304)); // 4 GB disp em kB
  const rec = extrairMetricasRecursos(colunas, escalares);
  assert.equal(rec.cpuPct, 25.0);
  assert.equal(rec.cpuCores, null);
  assert.equal(rec.memoriaTotalBytes, 8_388_608 * 1024);
  assert.equal(rec.memoriaUsoBytes, (8_388_608 - 4_194_304) * 1024);
  assert.equal(rec.memoriaPct, 50.0);
});

test('limitador de concorrência respeita o teto', async () => {
  const limitar = criarLimitadorConcorrencia(3);
  let ativos = 0;
  let pico = 0;
  const tarefa = () =>
    limitar(async () => {
      ativos += 1;
      pico = Math.max(pico, ativos);
      await new Promise((r) => setTimeout(r, 10));
      ativos -= 1;
    });
  await Promise.all(Array.from({ length: 12 }, tarefa));
  assert.ok(pico <= 3, `pico ${pico} deveria ser <= 3`);
  assert.equal(ativos, 0);
});

test('mutex serializa a mesma chave e paraleliza chaves distintas', async () => {
  const exclusivo = criarMutexPorChave();

  let ativosA = 0;
  let picoA = 0;
  const naChaveA = () =>
    exclusivo('A', async () => {
      ativosA += 1;
      picoA = Math.max(picoA, ativosA);
      await new Promise((r) => setTimeout(r, 5));
      ativosA -= 1;
    });
  await Promise.all([naChaveA(), naChaveA(), naChaveA()]);
  assert.equal(picoA, 1); // nunca 2 execuções simultâneas na mesma chave

  let ativos = 0;
  let pico = 0;
  const emChave = (k) =>
    exclusivo(k, async () => {
      ativos += 1;
      pico = Math.max(pico, ativos);
      await new Promise((r) => setTimeout(r, 10));
      ativos -= 1;
    });
  await Promise.all([emChave(1), emChave(2), emChave(3)]);
  assert.ok(pico >= 2, 'chaves distintas devem rodar em paralelo');
});
