import {
  abrirSessao,
  fecharSessao,
  obterEscalares,
  caminharColunas,
  textoVarbind,
  numeroVarbind,
  CredencialSnmp,
  OpcoesSessao,
  Varbind,
} from './client';
import { OID, COL, HR_STORAGE_TYPE, capacidadeBps } from './mib';
import {
  paraBigInt,
  calcularDeltaContador,
  octetosParaBps,
  deltaParaTaxaPorSegundo,
} from './counters';

export interface MetricasRecursos {
  cpuPct: number | null;
  cpuCores: number | null;
  memoriaUsoBytes: number | null;
  memoriaTotalBytes: number | null;
  memoriaPct: number | null;
  discoUsoBytes: number | null;
  discoTotalBytes: number | null;
  discoPct: number | null;
}

export const RECURSOS_VAZIOS: MetricasRecursos = {
  cpuPct: null,
  cpuCores: null,
  memoriaUsoBytes: null,
  memoriaTotalBytes: null,
  memoriaPct: null,
  discoUsoBytes: null,
  discoTotalBytes: null,
  discoPct: null,
};

export interface InterfaceBruta {
  ifIndex: number;
  ifDescr: string | null;
  ifName: string | null;
  ifAlias: string | null;
  ifType: number | null;
  capacidadeBps: number | null;
  adminStatus: number | null;
  operStatus: number | null;
  /** Largura do contador de octetos efetivamente lido (64 = ifHC, 32 = ifTable). */
  larguraOctetos: 32 | 64;
  inOctets: bigint | null;
  outOctets: bigint | null;
  inErrors: bigint | null;
  outErrors: bigint | null;
  inDiscards: bigint | null;
  outDiscards: bigint | null;
}

export interface ColetaSnmp {
  alcancavel: boolean;
  erro?: string;
  sysUptimeTicks: number | null;
  sysDescr: string | null;
  sysName: string | null;
  interfaces: InterfaceBruta[];
  recursos: MetricasRecursos;
}

function octetoBig(v: Varbind | undefined): bigint | null {
  if (!v || v.value == null) return null;
  return paraBigInt(v.value);
}

/**
 * Monta os registros de interface a partir das colunas caminhadas. Prefere os
 * contadores HC (Counter64, ifXTable) e cai para os de 32 bits quando o
 * equipamento não expõe a ifXTable. PURO — base dos testes.
 */
export function montarInterfaces(colunas: Map<string, Map<number, Varbind>>): InterfaceBruta[] {
  const col = (p: string) => colunas.get(p) ?? new Map<number, Varbind>();
  const ifDescr = col(COL.ifDescr);
  const ifName = col(COL.ifName);
  const ifAlias = col(COL.ifAlias);
  const ifType = col(COL.ifType);
  const ifAdmin = col(COL.ifAdminStatus);
  const ifOper = col(COL.ifOperStatus);
  const ifHighSpeed = col(COL.ifHighSpeed);
  const ifSpeed = col(COL.ifSpeed);
  const hcIn = col(COL.ifHCInOctets);
  const hcOut = col(COL.ifHCOutOctets);
  const inOct = col(COL.ifInOctets);
  const outOct = col(COL.ifOutOctets);
  const inErr = col(COL.ifInErrors);
  const outErr = col(COL.ifOutErrors);
  const inDisc = col(COL.ifInDiscards);
  const outDisc = col(COL.ifOutDiscards);

  // O conjunto de índices vem de qualquer coluna "âncora" presente.
  const indices = new Set<number>();
  for (const mapa of [ifDescr, ifName, ifOper, inOct, hcIn]) {
    for (const i of mapa.keys()) indices.add(i);
  }

  const interfaces: InterfaceBruta[] = [];
  for (const ifIndex of [...indices].sort((a, b) => a - b)) {
    const temHc = hcIn.has(ifIndex) || hcOut.has(ifIndex);
    const larguraOctetos: 32 | 64 = temHc ? 64 : 32;
    interfaces.push({
      ifIndex,
      ifDescr: textoVarbind(ifDescr.get(ifIndex)),
      ifName: textoVarbind(ifName.get(ifIndex)),
      ifAlias: textoVarbind(ifAlias.get(ifIndex)),
      ifType: numeroVarbind(ifType.get(ifIndex)),
      capacidadeBps: capacidadeBps(numeroVarbind(ifHighSpeed.get(ifIndex)), numeroVarbind(ifSpeed.get(ifIndex))),
      adminStatus: numeroVarbind(ifAdmin.get(ifIndex)),
      operStatus: numeroVarbind(ifOper.get(ifIndex)),
      larguraOctetos,
      inOctets: temHc ? octetoBig(hcIn.get(ifIndex)) : octetoBig(inOct.get(ifIndex)),
      outOctets: temHc ? octetoBig(hcOut.get(ifIndex)) : octetoBig(outOct.get(ifIndex)),
      inErrors: octetoBig(inErr.get(ifIndex)),
      outErrors: octetoBig(outErr.get(ifIndex)),
      inDiscards: octetoBig(inDisc.get(ifIndex)),
      outDiscards: octetoBig(outDisc.get(ifIndex)),
    });
  }
  return interfaces;
}

export interface LeituraAnteriorInterface {
  inOctets: bigint | null;
  outOctets: bigint | null;
  inErrors: bigint | null;
  outErrors: bigint | null;
  inDiscards: bigint | null;
  outDiscards: bigint | null;
  tempoMs: number;
  uptimeTicks: number;
}

export interface AmostraInterface {
  inBps: number | null;
  outBps: number | null;
  inErrPps: number | null;
  outErrPps: number | null;
  inDiscPps: number | null;
  outDiscPps: number | null;
}

/**
 * Calcula a amostra (bps/pps) de uma interface a partir da leitura atual e da
 * anterior persistida. PURO — delega o tratamento de wrap/reinício a
 * calcularDeltaContador. Qualquer métrica sem base ou descartada volta null.
 */
export function calcularAmostraInterface(
  atual: InterfaceBruta,
  anterior: LeituraAnteriorInterface | null,
  sysUptimeTicks: number,
  tempoMs: number
): AmostraInterface {
  const taxa = (
    valAnterior: bigint | null | undefined,
    valAtual: bigint | null,
    largura: 32 | 64,
    fatorBits: 8 | 1
  ): number | null => {
    if (!anterior || valAnterior == null || valAtual == null) return null;
    const r = calcularDeltaContador(
      { valor: valAnterior, tempoMs: anterior.tempoMs, uptimeTicks: anterior.uptimeTicks },
      { valor: valAtual, tempoMs, uptimeTicks: sysUptimeTicks },
      { largura }
    );
    if (r.descartado || r.delta == null || r.segundos == null) return null;
    return fatorBits === 8
      ? octetosParaBps(r.delta, r.segundos)
      : deltaParaTaxaPorSegundo(r.delta, r.segundos);
  };

  return {
    inBps: taxa(anterior?.inOctets, atual.inOctets, atual.larguraOctetos, 8),
    outBps: taxa(anterior?.outOctets, atual.outOctets, atual.larguraOctetos, 8),
    inErrPps: taxa(anterior?.inErrors, atual.inErrors, 32, 1),
    outErrPps: taxa(anterior?.outErrors, atual.outErrors, 32, 1),
    inDiscPps: taxa(anterior?.inDiscards, atual.inDiscards, 32, 1),
    outDiscPps: taxa(anterior?.outDiscards, atual.outDiscards, 32, 1),
  };
}

/**
 * Extrai métricas de hardware de servidores e equipamentos de rede (CPU, RAM, Disco)
 * a partir de HOST-RESOURCES-MIB (RFC 2790) e fallbacks (UCD-SNMP / Cisco / MikroTik).
 * PURO — base dos testes.
 */
export function extrairMetricasRecursos(
  colunas: Map<string, Map<number, Varbind>>,
  escalares: Map<string, Varbind>
): MetricasRecursos {
  const col = (p: string) => colunas.get(p) ?? new Map<number, Varbind>();

  // 1. CPU: média dos núcleos em hrProcessorLoad
  const hrLoad = col(COL.hrProcessorLoad);
  let cpuPct: number | null = null;
  let cpuCores: number | null = null;

  if (hrLoad.size > 0) {
    const valores: number[] = [];
    for (const vb of hrLoad.values()) {
      const n = numeroVarbind(vb);
      if (n != null && n >= 0 && n <= 100) valores.push(n);
    }
    if (valores.length > 0) {
      cpuCores = valores.length;
      const media = valores.reduce((acc, v) => acc + v, 0) / valores.length;
      cpuPct = Math.round(media * 10) / 10;
    }
  }

  // Fallbacks de CPU quando hrProcessorLoad não existir/responder vazio
  if (cpuPct == null) {
    const idle = numeroVarbind(escalares.get(OID.ssCpuIdle));
    if (idle != null && idle >= 0 && idle <= 100) {
      cpuPct = Math.round((100 - idle) * 10) / 10;
    } else {
      const cisco = numeroVarbind(escalares.get(OID.cpmCPUTotal5minRev));
      if (cisco != null && cisco >= 0 && cisco <= 100) {
        cpuPct = cisco;
      } else {
        const mikrotik = numeroVarbind(escalares.get(OID.mtxrProcessorLoad));
        if (mikrotik != null && mikrotik >= 0 && mikrotik <= 100) {
          cpuPct = mikrotik;
          cpuCores = 1;
        }
      }
    }
  }

  // 2. Memória RAM e Disco (hrStorageTable)
  const tipos = col(COL.hrStorageType);
  const descrs = col(COL.hrStorageDescr);
  const units = col(COL.hrStorageAllocationUnits);
  const sizes = col(COL.hrStorageSize);
  const useds = col(COL.hrStorageUsed);

  let memoriaUsoBytes: number | null = null;
  let memoriaTotalBytes: number | null = null;
  let memoriaPct: number | null = null;

  const storageIndices = new Set<number>();
  for (const m of [tipos, descrs, sizes, useds]) {
    for (const k of m.keys()) storageIndices.add(k);
  }

  // Procura entrada de RAM física
  for (const idx of storageIndices) {
    const tipoOid = textoVarbind(tipos.get(idx)) || '';
    const descr = textoVarbind(descrs.get(idx)) || '';
    const unit = numeroVarbind(units.get(idx)) || 1;
    const sizeUnits = numeroVarbind(sizes.get(idx));
    const usedUnits = numeroVarbind(useds.get(idx));

    const ehRamPorTipo = tipoOid === HR_STORAGE_TYPE.ram || tipoOid.endsWith('.1.25.2.1.2');
    const ehRamPorNome =
      /(physical memory|real memory|main memory|system ram|mem[oó]ria f[ií]sica|^ram$)/i.test(descr) &&
      !/(virtual|swap|buffer|cache)/i.test(descr);

    if ((ehRamPorTipo || ehRamPorNome) && sizeUnits != null && sizeUnits > 0 && usedUnits != null && usedUnits >= 0) {
      memoriaTotalBytes = sizeUnits * unit;
      memoriaUsoBytes = usedUnits * unit;
      memoriaPct = Math.min(100, Math.max(0, Math.round((memoriaUsoBytes / memoriaTotalBytes) * 1000) / 10));
      break;
    }
  }

  // Fallback de memória: UCD-SNMP (memTotalReal / memAvailReal / memTotalFree)
  if (memoriaTotalBytes == null) {
    const totalKb = numeroVarbind(escalares.get(OID.memTotalReal));
    const availKb = numeroVarbind(escalares.get(OID.memAvailReal)) ?? numeroVarbind(escalares.get(OID.memTotalFree));
    if (totalKb != null && totalKb > 0) {
      memoriaTotalBytes = totalKb * 1024;
      if (availKb != null && availKb >= 0) {
        memoriaUsoBytes = Math.max(0, (totalKb - availKb) * 1024);
        memoriaPct = Math.min(100, Math.max(0, Math.round((memoriaUsoBytes / memoriaTotalBytes) * 1000) / 10));
      }
    }
  }

  // 3. Discos Fixos (hrStorageFixedDisk ou partições /, C:, etc.)
  let totalDiscoAcc = 0;
  let usadoDiscoAcc = 0;
  let achouDisco = false;

  for (const idx of storageIndices) {
    const tipoOid = textoVarbind(tipos.get(idx)) || '';
    const descr = textoVarbind(descrs.get(idx)) || '';
    const unit = numeroVarbind(units.get(idx)) || 1;
    const sizeUnits = numeroVarbind(sizes.get(idx));
    const usedUnits = numeroVarbind(useds.get(idx));

    const ehDiscoFixo =
      tipoOid === HR_STORAGE_TYPE.fixedDisk ||
      tipoOid.endsWith('.1.25.2.1.4') ||
      /^((\/|[A-Za-z]:\\?).*)$/.test(descr);

    if (ehDiscoFixo && sizeUnits != null && sizeUnits > 0 && usedUnits != null && usedUnits >= 0) {
      achouDisco = true;
      totalDiscoAcc += sizeUnits * unit;
      usadoDiscoAcc += usedUnits * unit;
    }
  }

  let discoUsoBytes: number | null = null;
  let discoTotalBytes: number | null = null;
  let discoPct: number | null = null;

  if (achouDisco && totalDiscoAcc > 0) {
    discoTotalBytes = totalDiscoAcc;
    discoUsoBytes = usadoDiscoAcc;
    discoPct = Math.min(100, Math.max(0, Math.round((discoUsoBytes / discoTotalBytes) * 1000) / 10));
  }

  return {
    cpuPct,
    cpuCores,
    memoriaUsoBytes,
    memoriaTotalBytes,
    memoriaPct,
    discoUsoBytes,
    discoTotalBytes,
    discoPct,
  };
}

/**
 * Coleta SNMP completa de um dispositivo: sistema (sysUpTime/descr/name) +
 * recursos do servidor (CPU, Memória, Disco) + todas as interfaces com seus contadores.
 */
export async function coletarSnmp(
  ip: string,
  cred: CredencialSnmp,
  opcoes: OpcoesSessao = {}
): Promise<ColetaSnmp> {
  let session: ReturnType<typeof abrirSessao>;
  try {
    session = abrirSessao(ip, cred, opcoes);
  } catch (e) {
    return {
      alcancavel: false,
      erro: (e as Error).message,
      sysUptimeTicks: null,
      sysDescr: null,
      sysName: null,
      interfaces: [],
      recursos: { ...RECURSOS_VAZIOS },
    };
  }

  try {
    const escalares = await obterEscalares(session, [
      OID.sysUpTime,
      OID.sysDescr,
      OID.sysName,
      OID.ssCpuIdle,
      OID.memTotalReal,
      OID.memAvailReal,
      OID.memTotalFree,
      OID.cpmCPUTotal5minRev,
      OID.mtxrProcessorLoad,
    ]);
    const sysUptimeTicks = numeroVarbind(escalares.get(OID.sysUpTime));
    const colunas = await caminharColunas(session, [
      COL.ifDescr, COL.ifName, COL.ifAlias, COL.ifType, COL.ifAdminStatus, COL.ifOperStatus,
      COL.ifHighSpeed, COL.ifSpeed,
      COL.ifHCInOctets, COL.ifHCOutOctets, COL.ifInOctets, COL.ifOutOctets,
      COL.ifInErrors, COL.ifOutErrors, COL.ifInDiscards, COL.ifOutDiscards,
      // HOST-RESOURCES-MIB (RFC 2790) - CPU e armazenamento de servidores
      COL.hrProcessorLoad,
      COL.hrStorageType, COL.hrStorageDescr, COL.hrStorageAllocationUnits,
      COL.hrStorageSize, COL.hrStorageUsed,
    ]);
    return {
      alcancavel: true,
      sysUptimeTicks,
      sysDescr: textoVarbind(escalares.get(OID.sysDescr)),
      sysName: textoVarbind(escalares.get(OID.sysName)),
      interfaces: montarInterfaces(colunas),
      recursos: extrairMetricasRecursos(colunas, escalares),
    };
  } catch (e) {
    return {
      alcancavel: false,
      erro: (e as Error).message,
      sysUptimeTicks: null,
      sysDescr: null,
      sysName: null,
      interfaces: [],
      recursos: { ...RECURSOS_VAZIOS },
    };
  } finally {
    fecharSessao(session);
  }
}
