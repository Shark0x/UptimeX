import geoip from 'geoip-lite';

export interface GeoInfo {
  pais: string | null;
  regiao: string | null;
  cidade: string | null;
}

const SEM_LOCALIZACAO: GeoInfo = { pais: null, regiao: null, cidade: null };

// IPv4 mapeado em IPv6 (::ffff:1.2.3.4), como o Express entrega quando o Node
// escuta em dual-stack — sem isso o geoip-lite não reconhece o endereço.
function normalizarIp(ip: string): string {
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

export function localizarIp(ip?: string | null): GeoInfo {
  if (!ip) return SEM_LOCALIZACAO;
  const alvo = normalizarIp(ip);
  if (alvo === '::1' || alvo === '127.0.0.1' || /^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(alvo)) {
    return { pais: 'Local', regiao: null, cidade: 'Rede interna' };
  }
  const info = geoip.lookup(alvo);
  if (!info) return SEM_LOCALIZACAO;
  return {
    pais: info.country || null,
    regiao: info.region || null,
    cidade: info.city || null,
  };
}
