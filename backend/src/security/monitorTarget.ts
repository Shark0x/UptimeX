import net from 'net';

const bloqueiosAbsolutos = new net.BlockList();
bloqueiosAbsolutos.addSubnet('0.0.0.0', 8, 'ipv4');
bloqueiosAbsolutos.addSubnet('127.0.0.0', 8, 'ipv4');
bloqueiosAbsolutos.addSubnet('169.254.0.0', 16, 'ipv4');
bloqueiosAbsolutos.addSubnet('224.0.0.0', 4, 'ipv4');
bloqueiosAbsolutos.addSubnet('240.0.0.0', 4, 'ipv4');
bloqueiosAbsolutos.addAddress('::', 'ipv6');
bloqueiosAbsolutos.addAddress('::1', 'ipv6');
bloqueiosAbsolutos.addSubnet('::', 96, 'ipv6');
bloqueiosAbsolutos.addSubnet('64:ff9b::', 96, 'ipv6');
bloqueiosAbsolutos.addSubnet('64:ff9b:1::', 48, 'ipv6');
bloqueiosAbsolutos.addSubnet('fe80::', 10, 'ipv6');
bloqueiosAbsolutos.addSubnet('ff00::', 8, 'ipv6');

const redesNaoPublicas = new net.BlockList();
for (const [endereco, prefixo] of [
  ['10.0.0.0', 8], ['100.64.0.0', 10], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
] as Array<[string, number]>) {
  redesNaoPublicas.addSubnet(endereco, prefixo, 'ipv4');
}
redesNaoPublicas.addSubnet('fc00::', 7, 'ipv6');
redesNaoPublicas.addSubnet('2001:db8::', 32, 'ipv6');

function tipoIp(ip: string): 'ipv4' | 'ipv6' | null {
  const versao = net.isIP(ip);
  return versao === 4 ? 'ipv4' : versao === 6 ? 'ipv6' : null;
}

function allowlistConfigurada(): net.BlockList {
  const lista = new net.BlockList();
  const entradas = String(process.env.MONITOR_ALLOWED_CIDRS || '')
    .split(/[\s,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);

  for (const entrada of entradas) {
    const [endereco, prefixoTexto] = entrada.split('/');
    const tipo = tipoIp(endereco);
    if (!tipo) throw new Error(`MONITOR_ALLOWED_CIDRS contem endereco invalido: ${entrada}`);
    if (prefixoTexto === undefined) {
      lista.addAddress(endereco, tipo);
      continue;
    }
    const prefixo = Number(prefixoTexto);
    const maximo = tipo === 'ipv4' ? 32 : 128;
    if (!Number.isInteger(prefixo) || prefixo < 0 || prefixo > maximo) {
      throw new Error(`MONITOR_ALLOWED_CIDRS contem prefixo invalido: ${entrada}`);
    }
    lista.addSubnet(endereco, prefixo, tipo);
  }
  return lista;
}

export function validarDestinoMonitoramento(ip: string): { ok: true } | { ok: false; motivo: string } {
  if (ip.includes('%')) return { ok: false, motivo: 'IPv6 com identificador de interface nao e permitido.' };
  // O BlockList do Node normaliza IPv4 como IPv4-mapped IPv6. Manter o
  // prefixo ::ffff:0:0/96 dentro dele bloquearia tambem todo IPv4 legitimo.
  if (ip.toLowerCase().startsWith('::ffff:')) {
    return { ok: false, motivo: 'Enderecos IPv4-mapped IPv6 nao sao permitidos.' };
  }
  const tipo = tipoIp(ip);
  if (!tipo) return { ok: false, motivo: 'Informe um endereco IPv4 ou IPv6 literal valido.' };
  if (bloqueiosAbsolutos.check(ip, tipo)) {
    return { ok: false, motivo: 'Endereco local, link-local, reservado ou multicast nao pode ser monitorado.' };
  }

  let allowlist: net.BlockList;
  try {
    allowlist = allowlistConfigurada();
  } catch (erro) {
    return { ok: false, motivo: erro instanceof Error ? erro.message : 'Allowlist de monitoramento invalida.' };
  }
  const configuracao = String(process.env.MONITOR_ALLOWED_CIDRS || '').trim();
  const permitidoExplicitamente = configuracao !== '' && allowlist.check(ip, tipo);

  // Quando uma allowlist existe, ela se torna a fronteira completa. Sem uma,
  // somente enderecos publicos unicast sao aceitos; redes internas exigem opt-in.
  if (configuracao !== '' && !permitidoExplicitamente) {
    return { ok: false, motivo: 'Endereco fora de MONITOR_ALLOWED_CIDRS.' };
  }
  if (redesNaoPublicas.check(ip, tipo) && !permitidoExplicitamente) {
    return { ok: false, motivo: 'Rede privada/CGNAT exige inclusao explicita em MONITOR_ALLOWED_CIDRS.' };
  }
  return { ok: true };
}

export function destinoMonitoramentoPermitido(ip: string): boolean {
  return validarDestinoMonitoramento(ip).ok;
}

export function portaSnmpPermitida(porta: number): boolean {
  const portas = String(process.env.SNMP_ALLOWED_PORTS || '161')
    .split(/[\s,;]+/)
    .map(Number)
    .filter((valor) => Number.isInteger(valor) && valor >= 1 && valor <= 65535);
  return portas.includes(porta);
}

export function exigirDestinoMonitoramento(ip: string): void {
  const resultado = validarDestinoMonitoramento(ip);
  if (!resultado.ok) throw new Error(resultado.motivo);
}
