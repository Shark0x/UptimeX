// Cálculo de taxa a partir de contadores SNMP monotônicos (ifInOctets, ifHCInOctets,
// ifInErrors, ...). O SNMP expõe contadores cumulativos; a taxa instantânea é o
// delta entre duas leituras dividido pelo tempo decorrido. Precisa tratar:
//   - Counter32 vs Counter64 (links Gigabit+ estouram o de 32 bits rápido);
//   - wraparound (estorno) do contador ao atingir o teto;
//   - reinício do equipamento (contadores zeram — detectado por sysUpTime);
//   - amostras perdidas / intervalo absurdo (não extrapolar sobre buracos enormes).
// Puro e sem dependências — a base dos testes unitários da engine SNMP.

export const MAX_COUNTER32 = 2n ** 32n;
export const MAX_COUNTER64 = 2n ** 64n;

export type MotivoDescarte =
  | 'sem_anterior'       // primeira leitura: sem base para o delta
  | 'intervalo_invalido' // dt <= 0 (relógio/ordem)
  | 'intervalo_excessivo'// buraco grande demais entre amostras (amostra perdida)
  | 'reinicio'           // sysUpTime retrocedeu: equipamento reiniciou
  | 'retrocesso';        // contador 64 bits retrocedeu sem reinício: anomalia/reset

export interface LeituraContador {
  /** Valor bruto do contador (BigInt para suportar Counter64 sem perda). */
  valor: bigint;
  /** Momento da leitura em epoch ms. */
  tempoMs: number;
  /** sysUpTime em centésimos de segundo (TimeTicks). Detecta reinício. */
  uptimeTicks: number;
}

export interface ResultadoDelta {
  /** Delta corrigido do contador (unidades do contador), ou null se descartado. */
  delta: number | null;
  /** Segundos decorridos entre as leituras (para o cálculo da taxa). */
  segundos: number | null;
  descartado: boolean;
  motivo?: MotivoDescarte;
}

export interface OpcoesDelta {
  largura: 32 | 64;
  /** Acima disso o intervalo é considerado buraco (amostra perdida). Padrão 1h. */
  intervaloMaximoMs?: number;
}

/**
 * Delta corrigido entre duas leituras de um contador. Retorna `descartado:true`
 * (com motivo) quando não dá para confiar no resultado — nesses casos a amostra
 * NÃO deve virar um ponto no gráfico (evita picos falsos de Gbps).
 */
export function calcularDeltaContador(
  anterior: LeituraContador | null,
  atual: LeituraContador,
  opcoes: OpcoesDelta
): ResultadoDelta {
  if (!anterior) return { delta: null, segundos: null, descartado: true, motivo: 'sem_anterior' };

  const dtMs = atual.tempoMs - anterior.tempoMs;
  if (dtMs <= 0) return { delta: null, segundos: null, descartado: true, motivo: 'intervalo_invalido' };

  const intervaloMaximoMs = opcoes.intervaloMaximoMs ?? 3_600_000;
  if (dtMs > intervaloMaximoMs) {
    return { delta: null, segundos: null, descartado: true, motivo: 'intervalo_excessivo' };
  }

  // Reinício do equipamento: sysUpTime voltou no tempo (ou zerou) ⇒ contadores
  // reiniciaram. Qualquer delta aqui seria lixo. TimeTicks é Counter32 e também
  // estoura (~497 dias); um pequeno recuo perto do teto não é reinício, mas um
  // recuo grande é. Usamos uma folga para distinguir.
  const FOLGA_UPTIME = 60 * 100; // 60s em centésimos
  if (atual.uptimeTicks + FOLGA_UPTIME < anterior.uptimeTicks) {
    return { delta: null, segundos: null, descartado: true, motivo: 'reinicio' };
  }

  let delta = atual.valor - anterior.valor;
  if (delta < 0n) {
    if (opcoes.largura === 32) {
      // Estorno de 32 bits — comum em interfaces rápidas com ifInOctets (não-HC).
      delta += MAX_COUNTER32;
    } else {
      // Estorno de 64 bits é praticamente impossível num intervalo real; tratamos
      // como reset/anomalia e descartamos para não produzir um pico irreal.
      return { delta: null, segundos: null, descartado: true, motivo: 'retrocesso' };
    }
  }

  return { delta: Number(delta), segundos: dtMs / 1000, descartado: false };
}

/** Converte um delta de octetos em bits por segundo. */
export function octetosParaBps(delta: number, segundos: number): number {
  if (segundos <= 0) return 0;
  return (delta * 8) / segundos;
}

/** Converte um delta de pacotes/eventos em unidades por segundo (pps). */
export function deltaParaTaxaPorSegundo(delta: number, segundos: number): number {
  if (segundos <= 0) return 0;
  return delta / segundos;
}

/** Normaliza um valor vindo do net-snmp (Buffer de Counter64, number, bigint) em BigInt. */
export function paraBigInt(valor: unknown): bigint {
  if (typeof valor === 'bigint') return valor;
  if (typeof valor === 'number') return BigInt(Math.trunc(valor));
  if (Buffer.isBuffer(valor)) {
    // net-snmp devolve Counter64 como Buffer big-endian de até 8 bytes.
    let acc = 0n;
    for (const byte of valor) acc = (acc << 8n) | BigInt(byte);
    return acc;
  }
  if (typeof valor === 'string' && /^\d+$/.test(valor)) return BigInt(valor);
  return 0n;
}

/** Legível para humanos: bps → "123.4 Mbps" / "2.1 Gbps". */
export function formatarBps(bps: number): string {
  if (!Number.isFinite(bps) || bps < 0) return '—';
  if (bps >= 1e9) return `${(bps / 1e9).toFixed(2)} Gbps`;
  if (bps >= 1e6) return `${(bps / 1e6).toFixed(1)} Mbps`;
  if (bps >= 1e3) return `${(bps / 1e3).toFixed(1)} kbps`;
  return `${Math.round(bps)} bps`;
}
