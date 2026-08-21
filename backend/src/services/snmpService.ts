import * as snmp from 'net-snmp';
import { exigirDestinoMonitoramento, portaSnmpPermitida } from '../security/monitorTarget';

// OIDs padrão universais (RFC1213 / IF-MIB) — funcionam em MikroTik, Ubiquiti,
// Cisco e praticamente qualquer equipamento com SNMP habilitado.
const OID_SYS_UPTIME = '1.3.6.1.2.1.1.3.0';   // sysUpTime
const OID_SYS_DESCR  = '1.3.6.1.2.1.1.1.0';   // sysDescr
const OID_SYS_NAME   = '1.3.6.1.2.1.1.5.0';   // sysName

export interface SnmpResult {
  alcancavel: boolean;
  uptimeTicks?: number;
  sysDescr?: string;
  sysName?: string;
  erro?: string;
}

/**
 * Faz um SNMP GET simples (sysUpTime + sysDescr + sysName).
 * Se o dispositivo responder, consideramos "alcançável" via SNMP.
 */
export function consultarSnmp(
  ip: string,
  comunidade: string,
  porta: number = 161,
  timeoutMs: number = 3000
): Promise<SnmpResult> {
  exigirDestinoMonitoramento(ip);
  if (!portaSnmpPermitida(porta)) throw new Error('Porta SNMP fora da politica permitida.');
  return new Promise((resolve) => {
    const session = snmp.createSession(ip, comunidade, {
      port: porta,
      timeout: timeoutMs,
      retries: 1,
      version: snmp.Version2c,
    });

    session.get([OID_SYS_UPTIME, OID_SYS_DESCR, OID_SYS_NAME], (error: any, varbinds: any[]) => {
      session.close();

      if (error) {
        resolve({ alcancavel: false, erro: error.message || String(error) });
        return;
      }

      const hasError = varbinds.some((vb) => snmp.isVarbindError(vb));
      if (hasError) {
        resolve({ alcancavel: false, erro: 'SNMP varbind error' });
        return;
      }

      resolve({
        alcancavel: true,
        uptimeTicks: Number(varbinds[0].value),
        sysDescr: varbinds[1]?.value?.toString(),
        sysName: varbinds[2]?.value?.toString(),
      });
    });
  });
}
