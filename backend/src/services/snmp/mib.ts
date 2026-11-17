// OIDs padrão (RFC1213 MIB-II + IF-MIB / ifXTable). Universais: MikroTik, Cisco,
// Ubiquiti, Huawei OLTs, etc. As colunas HC (High Capacity, Counter64) do ifXTable
// são preferidas para tráfego — essenciais em links Gigabit+ onde o ifInOctets de
// 32 bits estoura em segundos.

// ---- Grupo system (escalares, sufixo .0) e fallbacks de recursos ----
export const OID = {
  sysDescr: '1.3.6.1.2.1.1.1.0',
  sysUpTime: '1.3.6.1.2.1.1.3.0',
  sysName: '1.3.6.1.2.1.1.5.0',
  sysLocation: '1.3.6.1.2.1.1.6.0',
  ifNumber: '1.3.6.1.2.1.2.1.0',
  // Fallbacks para CPU e Memória (quando HOST-RESOURCES-MIB não estiver disponível)
  ssCpuIdle: '1.3.6.1.4.1.2026.11.11.0', // UCD-SNMP CPU ociosa (%)
  memTotalReal: '1.3.6.1.4.1.2026.4.5.0', // UCD-SNMP RAM total (kB)
  memAvailReal: '1.3.6.1.4.1.2026.4.6.0', // UCD-SNMP RAM disponível (kB)
  memTotalFree: '1.3.6.1.4.1.2026.4.11.0', // UCD-SNMP RAM livre (kB)
  cpmCPUTotal5minRev: '1.3.6.1.4.1.9.9.109.1.1.1.1.8.1', // Cisco CPU 5 min
  mtxrProcessorLoad: '1.3.6.1.4.1.14988.1.1.1.3.1.1.1', // MikroTik CPU load
} as const;

// ---- Colunas de tabela (prefixo; o índice da interface ou recurso é o sufixo) ----
// ifTable (MIB-II, Counter32)
export const COL = {
  ifIndex: '1.3.6.1.2.1.2.2.1.1',
  ifDescr: '1.3.6.1.2.1.2.2.1.2',
  ifType: '1.3.6.1.2.1.2.2.1.3',
  ifSpeed: '1.3.6.1.2.1.2.2.1.5', // bits/s (satura em 4.29 Gbps → ver ifHighSpeed)
  ifAdminStatus: '1.3.6.1.2.1.2.2.1.7',
  ifOperStatus: '1.3.6.1.2.1.2.2.1.8',
  ifInOctets: '1.3.6.1.2.1.2.2.1.10', // Counter32
  ifInErrors: '1.3.6.1.2.1.2.2.1.14', // Counter32
  ifInDiscards: '1.3.6.1.2.1.2.2.1.13', // Counter32
  ifOutOctets: '1.3.6.1.2.1.2.2.1.16', // Counter32
  ifOutDiscards: '1.3.6.1.2.1.2.2.1.19', // Counter32
  ifOutErrors: '1.3.6.1.2.1.2.2.1.20', // Counter32
  // ifXTable (estendida)
  ifName: '1.3.6.1.2.1.31.1.1.1.1',
  ifHCInOctets: '1.3.6.1.2.1.31.1.1.1.6', // Counter64
  ifHCOutOctets: '1.3.6.1.2.1.31.1.1.1.10', // Counter64
  ifHighSpeed: '1.3.6.1.2.1.31.1.1.1.15', // Mbits/s (capacidade real do link)
  ifAlias: '1.3.6.1.2.1.31.1.1.1.18', // descrição configurada pelo operador

  // HOST-RESOURCES-MIB (RFC 2790) - Servidores Linux, Windows, BSD e appliances
  hrProcessorLoad: '1.3.6.1.2.1.25.3.3.1.2', // Carga de cada CPU core (0..100%)
  hrStorageType: '1.3.6.1.2.1.25.2.3.1.2', // Tipo de armazenamento (RAM, FixedDisk, etc.)
  hrStorageDescr: '1.3.6.1.2.1.25.2.3.1.3', // Descrição ("Physical memory", "/", "C:\\", etc.)
  hrStorageAllocationUnits: '1.3.6.1.2.1.25.2.3.1.4', // Bytes por unidade de alocação
  hrStorageSize: '1.3.6.1.2.1.25.2.3.1.5', // Tamanho total em unidades de alocação
  hrStorageUsed: '1.3.6.1.2.1.25.2.3.1.6', // Uso atual em unidades de alocação
} as const;

export const HR_STORAGE_TYPE = {
  other: '1.3.6.1.2.1.25.2.1.1',
  ram: '1.3.6.1.2.1.25.2.1.2',
  virtualMemory: '1.3.6.1.2.1.25.2.1.3',
  fixedDisk: '1.3.6.1.2.1.25.2.1.4',
} as const;

// ifOperStatus / ifAdminStatus (IF-MIB)
export const IF_STATUS: Record<number, string> = {
  1: 'up',
  2: 'down',
  3: 'testing',
  4: 'unknown',
  5: 'dormant',
  6: 'notPresent',
  7: 'lowerLayerDown',
};

export function rotuloStatusInterface(valor: number | null | undefined): string {
  if (valor == null) return 'unknown';
  return IF_STATUS[valor] ?? 'unknown';
}

/** Uma interface está "no ar" quando operacionalmente up (1). */
export function interfaceOperacional(operStatus: number | null | undefined): boolean {
  return operStatus === 1;
}

/**
 * Extrai o índice da interface (sufixo) de um OID completo, dado o prefixo da
 * coluna. Ex.: prefixo '...2.2.1.10' + oid '...2.2.1.10.3' ⇒ 3.
 */
export function indiceDoOid(oidCompleto: string, prefixoColuna: string): number | null {
  if (!oidCompleto.startsWith(prefixoColuna + '.')) return null;
  const sufixo = oidCompleto.slice(prefixoColuna.length + 1);
  // O índice do ifTable é um único subidentificador inteiro.
  if (!/^\d+$/.test(sufixo)) return null;
  return Number(sufixo);
}

/**
 * Capacidade do link em bits/s a partir de ifHighSpeed (Mbit/s) com fallback para
 * ifSpeed (bit/s). ifHighSpeed é preferido porque ifSpeed satura em ~4.29 Gbps.
 */
export function capacidadeBps(ifHighSpeedMbps: number | null, ifSpeedBps: number | null): number | null {
  if (ifHighSpeedMbps && ifHighSpeedMbps > 0) return ifHighSpeedMbps * 1_000_000;
  if (ifSpeedBps && ifSpeedBps > 0) return ifSpeedBps;
  return null;
}
