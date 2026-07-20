import ping from 'ping';

export interface PingResult {
  alcancavel: boolean;
  tempoMs?: number;
}

export interface PingMetrica {
  alcancavel: boolean;
  /** Latência média em ms; NULL quando nenhum echo voltou */
  latenciaMs: number | null;
  /** Perda de pacotes em % (0–100) */
  perdaPct: number;
}

/** Quantos echo requests por ciclo de verificação — base do cálculo de perda de pacotes */
const AMOSTRAS_POR_CICLO = 4;

function numeroOuNull(valor: string | number | undefined): number | null {
  if (valor === undefined || valor === 'unknown') return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

/**
 * Verificação simples de alcance (1 echo) — usada como fallback rápido do SNMP.
 */
export async function consultarPing(ip: string, timeoutSeg: number = 2): Promise<PingResult> {
  const res = await ping.promise.probe(ip, { timeout: timeoutSeg });
  return {
    alcancavel: res.alive,
    tempoMs: numeroOuNull(res.time) ?? undefined,
  };
}

/**
 * Medição completa: envia AMOSTRAS_POR_CICLO echos e retorna latência média + perda.
 * min_reply é o parâmetro portável do pacote `ping` pra quantidade de echos
 * (vira -n no Windows e -c no Linux/macOS), então funciona no PC local hoje
 * e no servidor Linux depois sem mudança de código.
 */
export async function medirPing(ip: string, timeoutSeg: number = 2): Promise<PingMetrica> {
  const res = await ping.promise.probe(ip, {
    timeout: timeoutSeg,
    min_reply: AMOSTRAS_POR_CICLO,
  });

  const latencia = numeroOuNull(res.avg) ?? numeroOuNull(res.time);
  let perda = numeroOuNull(res.packetLoss);
  if (perda === null) perda = res.alive ? 0 : 100;
  perda = Math.min(100, Math.max(0, perda));

  return {
    alcancavel: res.alive,
    latenciaMs: res.alive ? latencia : null,
    perdaPct: res.alive ? perda : 100,
  };
}
