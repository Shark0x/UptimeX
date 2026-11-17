import { workerQuery } from '../../db/pool';
import { paraBigInt } from './counters';
import { InterfaceBruta, AmostraInterface, LeituraAnteriorInterface } from './collector';

export type StatusColeta = 'ok' | 'erro' | 'stale' | 'sem_credencial' | 'pendente';

// timestamp "without time zone" volta como string naive ("YYYY-MM-DD HH:MM:SS.mmm").
// Escrita e leitura passam pelo mesmo host/TZ, então o round-trip é consistente
// para o cálculo de delta (a janela é de dezenas de segundos).
function tempoParaMs(valor: string | Date | null): number {
  if (!valor) return 0;
  if (valor instanceof Date) return valor.getTime();
  const t = Date.parse(valor.replace(' ', 'T'));
  return Number.isFinite(t) ? t : 0;
}

/** Carrega a última leitura bruta de cada interface (base para o delta do ciclo). */
export async function carregarLeiturasAnteriores(
  dispositivoId: number
): Promise<Map<number, LeituraAnteriorInterface>> {
  const [rows]: any = await workerQuery(
    `SELECT if_index, last_in_octets, last_out_octets, last_in_errors, last_out_errors,
            last_in_discards, last_out_discards, last_uptime_ticks, last_sample_at
       FROM snmp_interfaces WHERE dispositivo_id = ?`,
    [dispositivoId]
  );
  const mapa = new Map<number, LeituraAnteriorInterface>();
  for (const r of rows) {
    const tempoMs = tempoParaMs(r.last_sample_at);
    if (!tempoMs) continue;
    const big = (v: any) => (v == null ? null : paraBigInt(String(v)));
    mapa.set(Number(r.if_index), {
      inOctets: big(r.last_in_octets),
      outOctets: big(r.last_out_octets),
      inErrors: big(r.last_in_errors),
      outErrors: big(r.last_out_errors),
      inDiscards: big(r.last_in_discards),
      outDiscards: big(r.last_out_discards),
      tempoMs,
      uptimeTicks: Number(r.last_uptime_ticks) || 0,
    });
  }
  return mapa;
}

/** Upsert da interface: metadados + leitura bruta atual (estado do delta) + última taxa. */
export async function salvarInterface(
  dispositivoId: number,
  empresaId: number,
  iface: InterfaceBruta,
  amostra: AmostraInterface,
  sysUptimeTicks: number,
  quando: Date
): Promise<void> {
  const b = (v: bigint | null) => (v == null ? null : v.toString());
  await workerQuery(
    `INSERT INTO snmp_interfaces
       (dispositivo_id, empresa_id, if_index, if_descr, if_name, if_alias, if_type,
        capacidade_bps, admin_status, oper_status, largura_octetos,
        last_in_octets, last_out_octets, last_in_errors, last_out_errors,
        last_in_discards, last_out_discards, last_uptime_ticks, last_sample_at,
        in_bps, out_bps, visivel, atualizado_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE, now())
     ON CONFLICT (dispositivo_id, if_index) DO UPDATE SET
       empresa_id = EXCLUDED.empresa_id, if_descr = EXCLUDED.if_descr, if_name = EXCLUDED.if_name,
       if_alias = EXCLUDED.if_alias, if_type = EXCLUDED.if_type, capacidade_bps = EXCLUDED.capacidade_bps,
       admin_status = EXCLUDED.admin_status, oper_status = EXCLUDED.oper_status,
       largura_octetos = EXCLUDED.largura_octetos,
       last_in_octets = EXCLUDED.last_in_octets, last_out_octets = EXCLUDED.last_out_octets,
       last_in_errors = EXCLUDED.last_in_errors, last_out_errors = EXCLUDED.last_out_errors,
       last_in_discards = EXCLUDED.last_in_discards, last_out_discards = EXCLUDED.last_out_discards,
       last_uptime_ticks = EXCLUDED.last_uptime_ticks, last_sample_at = EXCLUDED.last_sample_at,
       in_bps = EXCLUDED.in_bps, out_bps = EXCLUDED.out_bps, visivel = TRUE, atualizado_em = now()`,
    [
      dispositivoId, empresaId, iface.ifIndex, iface.ifDescr, iface.ifName, iface.ifAlias, iface.ifType,
      iface.capacidadeBps, iface.adminStatus, iface.operStatus, iface.larguraOctetos,
      b(iface.inOctets), b(iface.outOctets), b(iface.inErrors), b(iface.outErrors),
      b(iface.inDiscards), b(iface.outDiscards), sysUptimeTicks, quando,
      amostra.inBps, amostra.outBps,
    ]
  );
}

export interface EstadoColeta {
  dispositivoId: number;
  empresaId: number;
  status: StatusColeta;
  sysUptimeTicks?: number | null;
  sysDescr?: string | null;
  sysName?: string | null;
  sucesso: boolean;
  erro?: string | null;
  totalInterfaces?: number;
  cpuPct?: number | null;
  cpuCores?: number | null;
  memoriaUsoBytes?: number | null;
  memoriaTotalBytes?: number | null;
  memoriaPct?: number | null;
  discoUsoBytes?: number | null;
  discoTotalBytes?: number | null;
  discoPct?: number | null;
}

/** Persiste o estado da coleta (sucesso zera falhas; erro incrementa). */
export async function atualizarColeta(e: EstadoColeta): Promise<void> {
  await workerQuery(
    `INSERT INTO snmp_coleta
       (dispositivo_id, empresa_id, status, sys_uptime_ticks, sys_descr, sys_name,
        ultima_coleta_at, ultimo_sucesso_at, falhas_consecutivas, erro, total_interfaces,
        cpu_pct, cpu_cores, memoria_uso_bytes, memoria_total_bytes, memoria_pct,
        disco_uso_bytes, disco_total_bytes, disco_pct, atualizado_em)
     VALUES (?, ?, ?, ?, ?, ?, now(), CASE WHEN ? THEN now() ELSE NULL END,
             CASE WHEN ? THEN 0 ELSE 1 END, ?, ?,
             ?, ?, ?, ?, ?, ?, ?, ?, now())
     ON CONFLICT (dispositivo_id) DO UPDATE SET
       empresa_id = EXCLUDED.empresa_id, status = EXCLUDED.status,
       sys_uptime_ticks = COALESCE(EXCLUDED.sys_uptime_ticks, snmp_coleta.sys_uptime_ticks),
       sys_descr = COALESCE(EXCLUDED.sys_descr, snmp_coleta.sys_descr),
       sys_name = COALESCE(EXCLUDED.sys_name, snmp_coleta.sys_name),
       ultima_coleta_at = now(),
       ultimo_sucesso_at = CASE WHEN ? THEN now() ELSE snmp_coleta.ultimo_sucesso_at END,
       falhas_consecutivas = CASE WHEN ? THEN 0 ELSE snmp_coleta.falhas_consecutivas + 1 END,
       erro = EXCLUDED.erro,
       total_interfaces = COALESCE(EXCLUDED.total_interfaces, snmp_coleta.total_interfaces),
       cpu_pct = CASE WHEN EXCLUDED.cpu_pct IS NOT NULL THEN EXCLUDED.cpu_pct ELSE snmp_coleta.cpu_pct END,
       cpu_cores = CASE WHEN EXCLUDED.cpu_cores IS NOT NULL THEN EXCLUDED.cpu_cores ELSE snmp_coleta.cpu_cores END,
       memoria_uso_bytes = CASE WHEN EXCLUDED.memoria_uso_bytes IS NOT NULL THEN EXCLUDED.memoria_uso_bytes ELSE snmp_coleta.memoria_uso_bytes END,
       memoria_total_bytes = CASE WHEN EXCLUDED.memoria_total_bytes IS NOT NULL THEN EXCLUDED.memoria_total_bytes ELSE snmp_coleta.memoria_total_bytes END,
       memoria_pct = CASE WHEN EXCLUDED.memoria_pct IS NOT NULL THEN EXCLUDED.memoria_pct ELSE snmp_coleta.memoria_pct END,
       disco_uso_bytes = CASE WHEN EXCLUDED.disco_uso_bytes IS NOT NULL THEN EXCLUDED.disco_uso_bytes ELSE snmp_coleta.disco_uso_bytes END,
       disco_total_bytes = CASE WHEN EXCLUDED.disco_total_bytes IS NOT NULL THEN EXCLUDED.disco_total_bytes ELSE snmp_coleta.disco_total_bytes END,
       disco_pct = CASE WHEN EXCLUDED.disco_pct IS NOT NULL THEN EXCLUDED.disco_pct ELSE snmp_coleta.disco_pct END,
       atualizado_em = now()`,
    [
      e.dispositivoId, e.empresaId, e.status, e.sysUptimeTicks ?? null, e.sysDescr ?? null, e.sysName ?? null,
      e.sucesso, e.sucesso, e.erro ?? null, e.totalInterfaces ?? 0,
      e.cpuPct ?? null, e.cpuCores ?? null,
      e.memoriaUsoBytes ?? null, e.memoriaTotalBytes ?? null, e.memoriaPct ?? null,
      e.discoUsoBytes ?? null, e.discoTotalBytes ?? null, e.discoPct ?? null,
      e.sucesso, e.sucesso,
    ]
  );
}
