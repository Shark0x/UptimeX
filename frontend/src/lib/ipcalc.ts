/**
 * Calculadora de sub-rede IPv4 a partir de um bloco CIDR (ex: 45.174.147.128/30).
 * Toda a aritmética é feita em inteiros de 32 bits sem sinal (>>> 0).
 */

export interface CalculoCidr {
  valido: true;
  prefixo: number;
  mascara: string;
  rede: string;
  broadcast: string;
  primeiroHost: string;
  ultimoHost: string;
  totalEnderecos: number;
  hostsUtilizaveis: number;
  observacao?: string;
}

export interface CidrInvalido {
  valido: false;
  erro: string;
}

const REGEX_CIDR = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/;

function paraInt(a: number, b: number, c: number, d: number): number {
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

function paraIp(n: number): string {
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

export function calcularCidr(bloco: string): CalculoCidr | CidrInvalido {
  const m = bloco.trim().match(REGEX_CIDR);
  if (!m) return { valido: false, erro: 'Use o formato IP/prefixo, ex: 45.174.147.128/30' };

  const octetos = m.slice(1, 5).map(Number);
  const prefixo = Number(m[5]);
  if (octetos.some((o) => o > 255)) return { valido: false, erro: 'Cada octeto vai de 0 a 255.' };
  if (prefixo > 32) return { valido: false, erro: 'O prefixo vai de /0 a /32.' };

  const ip = paraInt(octetos[0], octetos[1], octetos[2], octetos[3]);
  const mascara = prefixo === 0 ? 0 : (0xffffffff << (32 - prefixo)) >>> 0;
  const rede = (ip & mascara) >>> 0;
  const broadcast = (rede | (~mascara >>> 0)) >>> 0;
  const total = 2 ** (32 - prefixo);

  // Casos especiais: /31 é enlace ponto-a-ponto (RFC 3021, sem broadcast) e /32 é um IP único
  if (prefixo === 32) {
    return {
      valido: true, prefixo, mascara: paraIp(mascara), rede: paraIp(rede), broadcast: '—',
      primeiroHost: paraIp(rede), ultimoHost: paraIp(rede), totalEnderecos: 1, hostsUtilizaveis: 1,
      observacao: '/32 é um endereço único (host).',
    };
  }
  if (prefixo === 31) {
    return {
      valido: true, prefixo, mascara: paraIp(mascara), rede: paraIp(rede), broadcast: '—',
      primeiroHost: paraIp(rede), ultimoHost: paraIp(broadcast), totalEnderecos: 2, hostsUtilizaveis: 2,
      observacao: '/31 é enlace ponto-a-ponto (RFC 3021): os 2 endereços são utilizáveis, sem broadcast.',
    };
  }

  const avisoRede =
    rede !== ip ? `Atenção: ${paraIp(ip)} não é o endereço de rede deste bloco — a rede correta é ${paraIp(rede)}/${prefixo}.` : undefined;

  return {
    valido: true,
    prefixo,
    mascara: paraIp(mascara),
    rede: paraIp(rede),
    broadcast: paraIp(broadcast),
    primeiroHost: paraIp(rede + 1),
    ultimoHost: paraIp(broadcast - 1),
    totalEnderecos: total,
    hostsUtilizaveis: total - 2,
    observacao: avisoRede,
  };
}
