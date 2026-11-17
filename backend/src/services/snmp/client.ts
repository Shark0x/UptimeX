import * as snmp from 'net-snmp';
import { exigirDestinoMonitoramento, portaSnmpPermitida } from '../../security/monitorTarget';
import { indiceDoOid } from './mib';

// O net-snmp não exporta o tipo da sessão; derivamos do retorno de createSession
// (cobre tanto createSession quanto createV3Session).
export type SessaoSnmp = ReturnType<typeof snmp.createSession>;

export type VersaoSnmp = 'v2c' | 'v3';
export type NivelSnmpV3 = 'noAuthNoPriv' | 'authNoPriv' | 'authPriv';

export interface CredencialSnmp {
  versao: VersaoSnmp;
  // v2c
  comunidade?: string | null;
  // v3
  usuario?: string | null;
  nivel?: NivelSnmpV3 | null;
  authProtocolo?: string | null; // md5 | sha | sha224 | sha256 | sha384 | sha512
  authSenha?: string | null;
  privProtocolo?: string | null; // des | aes | aes256b | aes256r
  privSenha?: string | null;
}

export interface OpcoesSessao {
  porta?: number;
  timeoutMs?: number;
  retries?: number;
}

export interface Varbind {
  oid: string;
  type: number;
  value: unknown;
}

function nivelSeguranca(nivel: NivelSnmpV3 | null | undefined) {
  switch (nivel) {
    case 'authPriv':
      return snmp.SecurityLevel.authPriv;
    case 'authNoPriv':
      return snmp.SecurityLevel.authNoPriv;
    default:
      return snmp.SecurityLevel.noAuthNoPriv;
  }
}

function protocoloAuth(nome: string | null | undefined) {
  switch (String(nome || '').toLowerCase()) {
    case 'md5':
      return snmp.AuthProtocols.md5;
    case 'sha':
    case 'sha1':
      return snmp.AuthProtocols.sha;
    case 'sha224':
      return snmp.AuthProtocols.sha224;
    case 'sha256':
      return snmp.AuthProtocols.sha256;
    case 'sha384':
      return snmp.AuthProtocols.sha384;
    case 'sha512':
      return snmp.AuthProtocols.sha512;
    default:
      return snmp.AuthProtocols.sha; // padrão moderno sensato
  }
}

function protocoloPriv(nome: string | null | undefined) {
  switch (String(nome || '').toLowerCase()) {
    case 'des':
      return snmp.PrivProtocols.des;
    case 'aes':
    case 'aes128':
      return snmp.PrivProtocols.aes;
    case 'aes256':
    case 'aes256b':
      return snmp.PrivProtocols.aes256b;
    case 'aes256r':
      return snmp.PrivProtocols.aes256r;
    default:
      return snmp.PrivProtocols.aes;
  }
}

/**
 * Abre uma sessão SNMP (v2c ou v3). Aplica os mesmos guards de destino/porta do
 * ICMP: loopback/link-local/multicast bloqueados e porta restrita a SNMP_ALLOWED_PORTS.
 */
export function abrirSessao(ip: string, cred: CredencialSnmp, opcoes: OpcoesSessao = {}): SessaoSnmp {
  exigirDestinoMonitoramento(ip);
  const porta = opcoes.porta ?? 161;
  if (!portaSnmpPermitida(porta)) throw new Error('Porta SNMP fora da politica permitida.');

  const base = {
    port: porta,
    timeout: opcoes.timeoutMs ?? 4000,
    retries: opcoes.retries ?? 1,
    transport: 'udp4' as const,
  };

  if (cred.versao === 'v3') {
    if (!cred.usuario) throw new Error('Usuario SNMPv3 nao configurado.');
    const nivel = nivelSeguranca(cred.nivel);
    const user: any = { name: cred.usuario, level: nivel };
    if (nivel !== snmp.SecurityLevel.noAuthNoPriv) {
      user.authProtocol = protocoloAuth(cred.authProtocolo);
      user.authKey = cred.authSenha || '';
    }
    if (nivel === snmp.SecurityLevel.authPriv) {
      user.privProtocol = protocoloPriv(cred.privProtocolo);
      user.privKey = cred.privSenha || '';
    }
    return snmp.createV3Session(ip, user, { ...base, version: snmp.Version3 });
  }

  return snmp.createSession(ip, cred.comunidade || 'public', { ...base, version: snmp.Version2c });
}

export function fecharSessao(session: SessaoSnmp): void {
  try {
    session.close();
  } catch {
    /* já fechada */
  }
}

/** GET de escalares (sysUpTime/sysDescr/...). Rejeita em erro ou varbind inválido. */
export function obterEscalares(session: SessaoSnmp, oids: string[]): Promise<Map<string, Varbind>> {
  return new Promise((resolve, reject) => {
    session.get(oids, (erro: Error | null, varbinds: any[]) => {
      if (erro) return reject(erro);
      const mapa = new Map<string, Varbind>();
      for (const vb of varbinds) {
        if (snmp.isVarbindError(vb)) continue; // OID ausente nesse equipamento: ignora
        mapa.set(vb.oid, { oid: vb.oid, type: vb.type, value: vb.value });
      }
      resolve(mapa);
    });
  });
}

/**
 * Caminha uma coluna de tabela (ex.: ifHCInOctets) via GETBULK e devolve
 * { ifIndex -> varbind }. Usa subtree para seguir toda a coluna com eficiência.
 */
export function caminharColuna(
  session: SessaoSnmp,
  prefixoColuna: string,
  maxRepetitions = 20
): Promise<Map<number, Varbind>> {
  return new Promise((resolve, reject) => {
    const resultado = new Map<number, Varbind>();
    const feed = (varbinds: any[]) => {
      for (const vb of varbinds) {
        if (snmp.isVarbindError(vb)) continue;
        const indice = indiceDoOid(vb.oid, prefixoColuna);
        if (indice == null) continue;
        resultado.set(indice, { oid: vb.oid, type: vb.type, value: vb.value });
      }
    };
    const done = (erro?: Error | null) => {
      if (erro) return reject(erro);
      resolve(resultado);
    };
    session.subtree(prefixoColuna, maxRepetitions, feed, done);
  });
}

/** Caminha várias colunas em paralelo controlado (dentro da mesma sessão). */
export async function caminharColunas(
  session: SessaoSnmp,
  prefixos: string[]
): Promise<Map<string, Map<number, Varbind>>> {
  const saida = new Map<string, Map<number, Varbind>>();
  // Sequencial na mesma sessão: o net-snmp serializa requisições por socket, e
  // assim respeitamos o timeout por requisição sem disparar dezenas de GETBULK juntos.
  for (const prefixo of prefixos) {
    try {
      saida.set(prefixo, await caminharColuna(session, prefixo));
    } catch {
      // Coluna ausente/opcional (ex.: equipamento sem ifXTable): segue com as demais.
      saida.set(prefixo, new Map());
    }
  }
  return saida;
}

export function textoVarbind(vb: Varbind | undefined): string | null {
  if (!vb) return null;
  const v = vb.value;
  if (v == null) return null;
  if (Buffer.isBuffer(v)) return v.toString('utf8').replace(/\0+$/g, '').trim();
  return String(v);
}

export function numeroVarbind(vb: Varbind | undefined): number | null {
  if (!vb) return null;
  const v = vb.value;
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'string' && /^-?\d+$/.test(v)) return Number(v);
  if (Buffer.isBuffer(v)) {
    let acc = 0;
    for (const b of v) acc = acc * 256 + b;
    return acc;
  }
  return null;
}
