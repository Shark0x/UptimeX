import { descriptografarSegredo } from '../../security/secretCrypto';
import { CredencialSnmp, VersaoSnmp, NivelSnmpV3 } from './client';

// Linha de dispositivo com os campos SNMP (v2c + v3). As senhas vêm cifradas do
// banco (AES-GCM) e são decifradas sob demanda só aqui, na hora de abrir a sessão.
export interface DispositivoSnmpRow {
  snmp_versao?: string | null;
  comunidade_snmp?: string | null;
  snmp_usuario?: string | null;
  snmp_nivel?: string | null;
  snmp_auth_protocolo?: string | null;
  snmp_auth_senha?: string | null;
  snmp_priv_protocolo?: string | null;
  snmp_priv_senha?: string | null;
}

/** O dispositivo tem SNMP utilizável (v2c com comunidade, ou v3 com usuário)? */
export function temCredencialSnmp(d: DispositivoSnmpRow): boolean {
  if ((d.snmp_versao || 'v2c') === 'v3') return !!(d.snmp_usuario && d.snmp_usuario.trim());
  return !!(d.comunidade_snmp && d.comunidade_snmp.trim());
}

/**
 * Monta a credencial decifrada para abrir a sessão. Pode lançar se o segredo
 * cifrado não decifra com a DATA_ENCRYPTION_KEY atual — o chamador trata como
 * falha de coleta (status 'erro'), sem derrubar o ciclo.
 */
export function montarCredencialSnmp(d: DispositivoSnmpRow): CredencialSnmp {
  const versao: VersaoSnmp = d.snmp_versao === 'v3' ? 'v3' : 'v2c';
  if (versao === 'v3') {
    const nivel = (d.snmp_nivel as NivelSnmpV3) || 'authPriv';
    return {
      versao,
      usuario: d.snmp_usuario ?? null,
      nivel,
      authProtocolo: d.snmp_auth_protocolo ?? null,
      authSenha: d.snmp_auth_senha ? descriptografarSegredo(d.snmp_auth_senha) : null,
      privProtocolo: d.snmp_priv_protocolo ?? null,
      privSenha: d.snmp_priv_senha ? descriptografarSegredo(d.snmp_priv_senha) : null,
    };
  }
  return { versao, comunidade: descriptografarSegredo(d.comunidade_snmp) };
}
