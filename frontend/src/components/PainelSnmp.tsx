import { useEffect, useMemo, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, SnmpAmostra, SnmpEstado, SnmpInterface, SnmpRecursosAmostra } from '../api';
import { useAuth } from '../auth/AuthContext';

const TICK = { fill: '#82828E', fontSize: 9, fontFamily: '"IBM Plex Mono", monospace' };

function formatarBps(bps: number | null | undefined): string {
  if (bps == null || !Number.isFinite(bps) || bps < 0) return '—';
  if (bps >= 1e9) return `${(bps / 1e9).toFixed(2)} Gbps`;
  if (bps >= 1e6) return `${(bps / 1e6).toFixed(1)} Mbps`;
  if (bps >= 1e3) return `${(bps / 1e3).toFixed(1)} kbps`;
  return `${Math.round(bps)} bps`;
}

function formatarEixoBps(bps: number): string {
  if (bps >= 1e9) return `${(bps / 1e9).toFixed(1)}G`;
  if (bps >= 1e6) return `${Math.round(bps / 1e6)}M`;
  if (bps >= 1e3) return `${Math.round(bps / 1e3)}k`;
  return String(Math.round(bps));
}

function formatarBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return '—';
  if (bytes >= 1024 ** 4) return `${(bytes / 1024 ** 4).toFixed(1)} TB`;
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function corPercentual(pct: number | null | undefined): string {
  if (pct == null) return 'text-slate-300';
  if (pct >= 85) return 'text-offline';
  if (pct >= 70) return 'text-warn';
  return 'text-online';
}

function formatarUptime(ticks: number | null): string {
  if (ticks == null || ticks < 0) return '—';
  let seg = Math.floor(ticks / 100);
  const d = Math.floor(seg / 86400); seg -= d * 86400;
  const h = Math.floor(seg / 3600); seg -= h * 3600;
  const m = Math.floor(seg / 60);
  if (d > 0) return `${d}d ${h}h ${m}min`;
  if (h > 0) return `${h}h ${m}min`;
  return `${m}min`;
}

const CORES_STATUS: Record<string, string> = {
  ok: 'text-online border-online/30 bg-online/10',
  erro: 'text-offline border-offline/30 bg-offline/10',
  stale: 'text-warn border-warn/30 bg-warn/10',
  sem_credencial: 'text-muted border-white/10 bg-white/[0.03]',
  pendente: 'text-muted border-white/10 bg-white/[0.03]',
};

const ROTULO_STATUS: Record<string, string> = {
  ok: 'coletando', erro: 'erro', stale: 'atrasada',
  sem_credencial: 'sem credencial', pendente: 'aguardando',
};

function nomeInterface(i: SnmpInterface): string {
  return i.if_name || i.if_descr || `if ${i.if_index}`;
}

export function PainelSnmp({ dispositivoId }: { dispositivoId: number }) {
  const { usuario } = useAuth();
  const podeOperar = usuario?.role === 'admin' || usuario?.role === 'operador';

  const [estado, setEstado] = useState<SnmpEstado | null>(null);
  const [interfaces, setInterfaces] = useState<SnmpInterface[]>([]);
  const [selecionada, setSelecionada] = useState<number | null>(null);
  const [historico, setHistorico] = useState<SnmpAmostra[]>([]);
  const [historicoRecursos, setHistoricoRecursos] = useState<SnmpRecursosAmostra[]>([]);
  const [abaAtiva, setAbaAtiva] = useState<'trafego' | 'recursos'>('trafego');
  const [carregando, setCarregando] = useState(true);
  const [coletando, setColetando] = useState(false);

  async function carregar() {
    setCarregando(true);
    const [est, ifs] = await Promise.all([
      api.snmpEstado(dispositivoId).catch(() => null),
      api.snmpInterfaces(dispositivoId).catch(() => [] as SnmpInterface[]),
    ]);
    setEstado(est);
    setInterfaces(ifs);
    // Se o dispositivo possui métricas de CPU/RAM e nenhuma interface descoberta ou com tráfego, foca recursos
    const temRecursos = est?.cpu_pct != null || est?.memoria_pct != null;
    const temIfaceComTrafego = ifs.some((i) => (i.in_bps ?? 0) > 0 || (i.out_bps ?? 0) > 0);
    if (temRecursos && !temIfaceComTrafego && ifs.length === 0) {
      setAbaAtiva('recursos');
    }
    // Seleciona por padrão a primeira interface com tráfego.
    setSelecionada((atual) => atual ?? ifs.find((i) => (i.in_bps ?? 0) > 0 || (i.out_bps ?? 0) > 0)?.if_index ?? ifs[0]?.if_index ?? null);
    setCarregando(false);
  }

  useEffect(() => {
    setSelecionada(null);
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispositivoId]);

  useEffect(() => {
    if (selecionada == null) {
      setHistorico([]);
      return;
    }
    let ativo = true;
    api.snmpHistoricoInterface(dispositivoId, selecionada, 60)
      .then((h) => ativo && setHistorico(h))
      .catch(() => ativo && setHistorico([]));
    return () => { ativo = false; };
  }, [dispositivoId, selecionada, estado?.ultima_coleta_at]);

  useEffect(() => {
    let ativo = true;
    api.snmpHistoricoRecursos(dispositivoId, 60)
      .then((h) => ativo && setHistoricoRecursos(h))
      .catch(() => ativo && setHistoricoRecursos([]));
    return () => { ativo = false; };
  }, [dispositivoId, estado?.ultima_coleta_at]);

  async function coletarAgora() {
    setColetando(true);
    try {
      await api.coletarSnmp(dispositivoId);
      // Dá um instante para a coleta persistir antes de reler.
      await new Promise((r) => setTimeout(r, 1200));
      await carregar();
    } finally {
      setColetando(false);
    }
  }

  const dadosGrafico = useMemo(
    () => historico.map((a) => ({ timestamp: a.timestamp, download: a.in_bps ?? 0, upload: a.out_bps ?? 0 })),
    [historico]
  );

  const dadosGraficoRecursos = useMemo(
    () =>
      historicoRecursos.map((a) => ({
        timestamp: a.timestamp,
        cpu: a.cpu_pct ?? 0,
        memoria: a.memoria_pct ?? 0,
        disco: a.disco_pct ?? 0,
      })),
    [historicoRecursos]
  );

  const status = estado?.status ?? 'pendente';
  const atrasada = estado?.atrasada ?? false;
  const badgeStatus = atrasada && status === 'ok' ? 'stale' : status;

  return (
    <section className="w-full min-w-0 overflow-hidden rounded-2xl border border-white/[0.07] bg-gradient-to-br from-deep-900/95 to-deep-950 shadow-glass p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="eyebrow mb-1">SNMP · servidores & tráfego</p>
          <h2 className="font-display text-base font-semibold text-slate-100">Coleta SNMP nativa</h2>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${CORES_STATUS[badgeStatus] || CORES_STATUS.pendente}`}>
            {ROTULO_STATUS[badgeStatus] || badgeStatus}
          </span>
          {podeOperar && (
            <button onClick={coletarAgora} disabled={coletando} className="btn-ghost text-[11px] disabled:opacity-50">
              {coletando ? 'coletando…' : 'Coletar agora'}
            </button>
          )}
        </div>
      </div>

      {status === 'sem_credencial' ? (
        <p className="mt-3 rounded-xl border border-dashed border-white/10 bg-white/[0.015] px-3 py-4 text-center font-mono text-[11px] text-muted">
          Sem credencial SNMP. Configure a comunidade (v2c) ou o usuário (v3) na edição do dispositivo para coletar CPU, memória e interfaces.
        </p>
      ) : (
        <>
          {/* Métricas de hardware & sistema */}
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 min-w-0">
              <p className="text-[9px] uppercase tracking-[0.16em] text-muted font-mono mb-1">CPU</p>
              <p className={`stat-number text-sm ${corPercentual(estado?.cpu_pct)}`}>
                {estado?.cpu_pct != null ? `${estado.cpu_pct}%` : '—'}
              </p>
              <p className="text-[10px] text-muted font-mono truncate mt-0.5">
                {estado?.cpu_cores ? `${estado.cpu_cores} núcleo(s)` : (estado?.cpu_pct != null ? 'Carga média' : 'Host Resources')}
              </p>
            </div>

            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 min-w-0">
              <p className="text-[9px] uppercase tracking-[0.16em] text-muted font-mono mb-1">Memória RAM</p>
              <p className={`stat-number text-sm ${corPercentual(estado?.memoria_pct)}`}>
                {estado?.memoria_pct != null ? `${estado.memoria_pct}%` : '—'}
              </p>
              <p className="text-[10px] text-muted font-mono truncate mt-0.5" title={estado?.memoria_total_bytes ? `${formatarBytes(estado.memoria_uso_bytes)} de ${formatarBytes(estado.memoria_total_bytes)}` : ''}>
                {estado?.memoria_total_bytes ? `${formatarBytes(estado.memoria_uso_bytes)} / ${formatarBytes(estado.memoria_total_bytes)}` : 'RAM física'}
              </p>
            </div>

            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 min-w-0">
              <p className="text-[9px] uppercase tracking-[0.16em] text-muted font-mono mb-1">Uptime</p>
              <p className="stat-number text-sm">{formatarUptime(estado?.sys_uptime_ticks ?? null)}</p>
              <p className="text-[10px] text-muted font-mono truncate mt-0.5">
                {estado?.disco_pct != null ? `Disco: ${estado.disco_pct}%` : 'Tempo de atividade'}
              </p>
            </div>

            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 min-w-0">
              <p className="text-[9px] uppercase tracking-[0.16em] text-muted font-mono mb-1">Equipamento</p>
              <p className="font-mono text-[11px] text-slate-300 truncate" title={estado?.sys_descr || ''}>
                {estado?.sys_name || estado?.sys_descr || '—'}
              </p>
              <p className="text-[10px] text-muted font-mono truncate mt-0.5" title={estado?.sys_descr || ''}>
                {estado?.sys_descr || 'RFC1213 / HOST-MIB'}
              </p>
            </div>
          </div>

          {atrasada && status !== 'erro' && (
            <p className="mt-2 rounded-lg border border-warn/30 bg-warn/10 px-2.5 py-1.5 font-mono text-[10px] text-warn">
              ⚠ Coleta atrasada — o equipamento não respondeu no tempo previsto.
            </p>
          )}
          {status === 'erro' && estado?.erro && (
            <p className="mt-2 rounded-lg border border-offline/30 bg-offline/10 px-2.5 py-1.5 font-mono text-[10px] text-offline">
              Falha na coleta: {estado.erro}
            </p>
          )}

          {/* Abas do gráfico (Tráfego de rede vs CPU & Memória) */}
          <div className="mt-3 flex items-center justify-between border-b border-white/[0.06] pb-2">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setAbaAtiva('trafego')}
                className={`rounded-lg px-2.5 py-1 font-mono text-[11px] transition-colors ${
                  abaAtiva === 'trafego'
                    ? 'bg-signal-600/20 text-signal-300 border border-signal-500/30 font-medium'
                    : 'text-muted hover:text-slate-200'
                }`}
              >
                Tráfego {selecionada != null && `(${interfaces.find((i) => i.if_index === selecionada)?.if_name || `if ${selecionada}`})`}
              </button>
              <button
                type="button"
                onClick={() => setAbaAtiva('recursos')}
                className={`rounded-lg px-2.5 py-1 font-mono text-[11px] transition-colors ${
                  abaAtiva === 'recursos'
                    ? 'bg-signal-600/20 text-signal-300 border border-signal-500/30 font-medium'
                    : 'text-muted hover:text-slate-200'
                }`}
              >
                CPU & Memória {estado?.cpu_pct != null && `(${estado.cpu_pct}%)`}
              </button>
            </div>
            <span className="font-mono text-[9px] text-muted uppercase tracking-wider">Última hora</span>
          </div>

          {/* Gráfico de Tráfego */}
          {abaAtiva === 'trafego' && (
            <div className="mt-2">
              <div className="rounded-xl border border-white/[0.06] bg-deep-950/30 px-1 pt-2" style={{ height: 168 }}>
                {dadosGrafico.length === 0 ? (
                  <div className="flex h-full items-center justify-center font-mono text-[10px] text-muted">
                    {selecionada == null
                      ? 'Selecione uma interface abaixo para visualizar o tráfego.'
                      : 'Sem amostras ainda (aguarde ao menos 2 coletas).'}
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={dadosGrafico} margin={{ top: 4, right: 10, bottom: 4, left: -8 }}>
                      <defs>
                        <linearGradient id={`snmp-dl-${dispositivoId}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#2DD4BF" stopOpacity={0.3} />
                          <stop offset="100%" stopColor="#2DD4BF" stopOpacity={0.02} />
                        </linearGradient>
                        <linearGradient id={`snmp-ul-${dispositivoId}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#8B5CF6" stopOpacity={0.25} />
                          <stop offset="100%" stopColor="#8B5CF6" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="rgba(148,163,184,0.08)" vertical={false} />
                      <XAxis
                        dataKey="timestamp" tick={TICK} axisLine={false} tickLine={false} minTickGap={52}
                        tickFormatter={(v) => new Date(String(v)).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                      />
                      <YAxis tick={TICK} axisLine={false} tickLine={false} width={44} tickFormatter={formatarEixoBps} />
                      <Tooltip
                        contentStyle={{ background: 'rgba(11,11,15,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, fontFamily: 'IBM Plex Mono', fontSize: 11 }}
                        labelFormatter={(v) => new Date(String(v)).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        formatter={(valor: any, nome: any) => [formatarBps(Number(valor)), nome === 'download' ? 'Download' : 'Upload']}
                      />
                      <Area type="monotone" dataKey="download" stroke="#2DD4BF" strokeWidth={2} fill={`url(#snmp-dl-${dispositivoId})`} isAnimationActive={false} dot={false} />
                      <Area type="monotone" dataKey="upload" stroke="#8B5CF6" strokeWidth={2} fill={`url(#snmp-ul-${dispositivoId})`} isAnimationActive={false} dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          )}

          {/* Gráfico de CPU & Memória */}
          {abaAtiva === 'recursos' && (
            <div className="mt-2">
              <div className="mb-2 flex items-center justify-between font-mono text-[9px]">
                <span className="text-muted uppercase tracking-[0.16em]">Carga de Recursos</span>
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1 text-teal-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-teal-400" />
                    CPU {estado?.cpu_pct != null ? `${estado.cpu_pct}%` : ''}
                  </span>
                  <span className="flex items-center gap-1 text-violet-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
                    Memória {estado?.memoria_pct != null ? `${estado.memoria_pct}%` : ''}
                  </span>
                  {estado?.disco_pct != null && (
                    <span className="flex items-center gap-1 text-amber-400">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                      Disco {estado.disco_pct}%
                    </span>
                  )}
                </div>
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-deep-950/30 px-1 pt-2" style={{ height: 168 }}>
                {dadosGraficoRecursos.length === 0 ? (
                  <div className="flex h-full items-center justify-center font-mono text-[10px] text-muted">
                    {estado?.cpu_pct == null && estado?.memoria_pct == null
                      ? 'Nenhuma métrica de CPU/Memória detectada ainda neste host.'
                      : 'Sem amostras de recursos ainda (aguarde ao menos 2 coletas).'}
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={dadosGraficoRecursos} margin={{ top: 4, right: 10, bottom: 4, left: -8 }}>
                      <defs>
                        <linearGradient id={`snmp-cpu-${dispositivoId}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#2DD4BF" stopOpacity={0.35} />
                          <stop offset="100%" stopColor="#2DD4BF" stopOpacity={0.02} />
                        </linearGradient>
                        <linearGradient id={`snmp-mem-${dispositivoId}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#8B5CF6" stopOpacity={0.3} />
                          <stop offset="100%" stopColor="#8B5CF6" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="rgba(148,163,184,0.08)" vertical={false} />
                      <XAxis
                        dataKey="timestamp" tick={TICK} axisLine={false} tickLine={false} minTickGap={52}
                        tickFormatter={(v) => new Date(String(v)).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                      />
                      <YAxis tick={TICK} domain={[0, 100]} axisLine={false} tickLine={false} width={38} tickFormatter={(v) => `${v}%`} />
                      <Tooltip
                        contentStyle={{ background: 'rgba(11,11,15,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, fontFamily: 'IBM Plex Mono', fontSize: 11 }}
                        labelFormatter={(v) => new Date(String(v)).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        formatter={(valor: any, nome: any) => [
                          `${valor}%`,
                          nome === 'cpu' ? 'CPU' : (nome === 'memoria' ? 'Memória RAM' : 'Disco'),
                        ]}
                      />
                      <Area type="monotone" dataKey="cpu" stroke="#2DD4BF" strokeWidth={2} fill={`url(#snmp-cpu-${dispositivoId})`} isAnimationActive={false} dot={false} />
                      <Area type="monotone" dataKey="memoria" stroke="#8B5CF6" strokeWidth={2} fill={`url(#snmp-mem-${dispositivoId})`} isAnimationActive={false} dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          )}

          {/* tabela de interfaces */}
          <div className="mt-3">
            <p className="mb-2 font-mono text-[9px] uppercase tracking-[0.18em] text-muted">
              Interfaces {interfaces.length > 0 && `(${interfaces.length})`}
            </p>
            {carregando ? (
              <div className="h-20 animate-pulse rounded-xl border border-white/[0.05] bg-white/[0.025]" />
            ) : interfaces.length === 0 ? (
              <p className="rounded-xl border border-dashed border-white/10 bg-white/[0.015] px-3 py-4 text-center font-mono text-[11px] text-muted">
                Nenhuma interface de rede descoberta ainda.
              </p>
            ) : (
              <div className="max-h-72 overflow-y-auto overflow-x-auto rounded-xl border border-white/[0.06]">
                <table className="w-full min-w-[420px] text-left font-mono text-[11px]">
                  <thead className="sticky top-0 bg-deep-900 text-muted">
                    <tr>
                      <th className="px-2 py-1.5">Interface</th>
                      <th className="px-1">Status</th>
                      <th className="px-1 text-right">↓ in</th>
                      <th className="px-2 text-right">↑ out</th>
                    </tr>
                  </thead>
                  <tbody>
                    {interfaces.map((i) => {
                      const up = i.oper_status === 1;
                      const sel = i.if_index === selecionada && abaAtiva === 'trafego';
                      return (
                        <tr
                          key={i.if_index}
                          onClick={() => {
                            setSelecionada(i.if_index);
                            setAbaAtiva('trafego');
                          }}
                          className={`cursor-pointer border-t border-white/[0.04] transition-colors ${sel ? 'bg-signal-600/10' : 'hover:bg-white/[0.03]'}`}
                        >
                          <td className="px-2 py-1.5 min-w-0">
                            <span className="text-slate-200">{nomeInterface(i)}</span>
                            {i.if_alias && <span className="ml-1.5 text-muted">· {i.if_alias}</span>}
                          </td>
                          <td className="px-1">
                            <span className={`inline-flex items-center gap-1 ${up ? 'text-online' : 'text-offline'}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${up ? 'bg-online' : 'bg-offline'}`} />
                              {up ? 'up' : 'down'}
                            </span>
                          </td>
                          <td className="px-1 text-right text-teal-400">{formatarBps(i.in_bps)}</td>
                          <td className="px-2 text-right text-violet-400">{formatarBps(i.out_bps)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
