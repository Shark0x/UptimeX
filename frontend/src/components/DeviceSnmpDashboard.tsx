import { useEffect, useMemo, useState } from 'react';
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, Dispositivo, SnmpAmostra, SnmpEstado, SnmpInterface, SnmpRecursosAmostra } from '../api';
import { useAuth } from '../auth/AuthContext';

const TICK = { fill: '#82828E', fontSize: 9, fontFamily: '"IBM Plex Mono", monospace' };

function formatarBps(bps: number | null | undefined): string {
  if (bps == null || !Number.isFinite(bps) || bps < 0) return '—';
  if (bps >= 1e9) return `${(bps / 1e9).toFixed(2)} Gbps`;
  if (bps >= 1e6) return `${(bps / 1e6).toFixed(1)} Mbps`;
  if (bps >= 1e3) return `${(bps / 1e3).toFixed(1)} kbps`;
  return `${Math.round(bps)} bps`;
}
function eixoBps(bps: number): string {
  if (bps >= 1e9) return `${(bps / 1e9).toFixed(1)}G`;
  if (bps >= 1e6) return `${Math.round(bps / 1e6)}M`;
  if (bps >= 1e3) return `${Math.round(bps / 1e3)}k`;
  return String(Math.round(bps));
}
function formatarBytes(b: number | null | undefined): string {
  if (b == null || !Number.isFinite(b) || b <= 0) return '—';
  if (b >= 1024 ** 4) return `${(b / 1024 ** 4).toFixed(1)} TB`;
  if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(1)} GB`;
  if (b >= 1024 ** 2) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024).toFixed(0)} KB`;
}
function formatarUptime(ticks: number | null | undefined): string {
  if (ticks == null || ticks < 0) return '—';
  let s = Math.floor(ticks / 100);
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}min`;
  return `${m}min`;
}
function horaEixo(ts: string) {
  return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}
// Paleta única teal; só o estado crítico (>=90%) vira vermelho de alarme.
function corPct(pct: number | null | undefined): string {
  if (pct == null) return '#475569';        // sem dado → neutro
  return pct >= 90 ? '#ff4d57' : '#2dd4bf'; // teal normal · vermelho só no crítico
}
function interfaceVirtual(i: SnmpInterface): boolean {
  const n = (i.if_name || i.if_descr || '').toLowerCase();
  return /^(lo|docker|veth|br-|virbr|tap|vnet|cali|flannel|cni)/.test(n);
}
function nomeIf(i: SnmpInterface): string {
  return i.if_name || i.if_descr || `if ${i.if_index}`;
}

/** Donut/gauge circular com o % no centro — estilo "Growth 68%". */
function Gauge({ pct, titulo, legenda }: { pct: number | null | undefined; titulo: string; legenda?: string }) {
  const R = 42;
  const C = 2 * Math.PI * R;
  const v = pct == null ? 0 : Math.max(0, Math.min(100, pct));
  const cor = corPct(pct);
  const id = `g-${titulo.replace(/\W/g, '')}`;
  return (
    <div className="flex flex-col items-center">
      <div className="relative w-28 h-28">
        <svg viewBox="0 0 100 100" className="w-full h-full">
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={cor} />
              <stop offset="100%" stopColor={cor} stopOpacity={0.55} />
            </linearGradient>
          </defs>
          <circle cx="50" cy="50" r={R} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="9" />
          <circle
            cx="50" cy="50" r={R} fill="none" stroke={`url(#${id})`} strokeWidth="9" strokeLinecap="round"
            strokeDasharray={C} strokeDashoffset={C * (1 - v / 100)}
            transform="rotate(-90 50 50)" style={{ transition: 'stroke-dashoffset .6s ease' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-mono text-2xl font-semibold text-slate-100 tabular-nums">
            {pct == null ? '—' : `${Math.round(v)}%`}
          </span>
        </div>
      </div>
      <p className="mt-1 font-display text-sm text-slate-200">{titulo}</p>
      {legenda && <p className="font-mono text-[10px] text-muted">{legenda}</p>}
    </div>
  );
}

/** Barra de progresso com uso/total — estilo "Spending". */
function Barra({ titulo, pct, detalhe }: { titulo: string; pct: number | null | undefined; detalhe?: string }) {
  const v = pct == null ? 0 : Math.max(0, Math.min(100, pct));
  const cor = corPct(pct);
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="font-display text-sm text-slate-200">{titulo}</span>
        <span className="font-mono text-sm tabular-nums" style={{ color: cor }}>
          {pct == null ? '—' : `${Math.round(v)}%`}
        </span>
      </div>
      <div className="mt-1.5 h-2.5 rounded-full bg-white/[0.06] overflow-hidden">
        <div className="h-full rounded-full transition-[width] duration-700"
          style={{ width: `${v}%`, background: `linear-gradient(90deg, ${cor}, ${cor}aa)` }} />
      </div>
      {detalhe && <p className="mt-1 font-mono text-[10px] text-muted">{detalhe}</p>}
    </div>
  );
}

// Card glass base
function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-white/[0.08] bg-gradient-to-br from-deep-900/70 to-deep-900/40 backdrop-blur-xl shadow-glass p-4 ${className}`}>
      {children}
    </div>
  );
}

const CORES_STATUS: Record<string, string> = {
  ok: 'text-teal-400 border-teal-500/30 bg-teal-500/10',
  erro: 'text-offline border-offline/30 bg-offline/10',
  stale: 'text-teal-300/80 border-teal-500/20 bg-teal-500/[0.06]',
  sem_credencial: 'text-muted border-white/10 bg-white/[0.03]',
  pendente: 'text-muted border-white/10 bg-white/[0.03]',
};
const ROTULO_STATUS: Record<string, string> = {
  ok: 'coletando', erro: 'erro', stale: 'atrasada', sem_credencial: 'sem credencial', pendente: 'aguardando',
};

export function DeviceSnmpDashboard({ dispositivo }: { dispositivo: Dispositivo }) {
  const dispositivoId = dispositivo.id;
  const { usuario } = useAuth();
  const podeOperar = usuario?.role === 'admin' || usuario?.role === 'operador';

  const [estado, setEstado] = useState<SnmpEstado | null>(null);
  const [interfaces, setInterfaces] = useState<SnmpInterface[]>([]);
  const [recursos, setRecursos] = useState<SnmpRecursosAmostra[]>([]);
  const [ifSelecionada, setIfSelecionada] = useState<number | null>(null);
  const [trafego, setTrafego] = useState<SnmpAmostra[]>([]);
  const [mostrarTodas, setMostrarTodas] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [coletando, setColetando] = useState(false);

  async function carregar() {
    setCarregando(true);
    const [est, ifs, rec] = await Promise.all([
      api.snmpEstado(dispositivoId).catch(() => null),
      api.snmpInterfaces(dispositivoId).catch(() => [] as SnmpInterface[]),
      api.snmpHistoricoRecursos(dispositivoId, 60).catch(() => [] as SnmpRecursosAmostra[]),
    ]);
    setEstado(est);
    setInterfaces(ifs);
    setRecursos(rec);
    setIfSelecionada((atual) => {
      if (atual != null && ifs.some((i) => i.if_index === atual)) return atual;
      const fisicaComTrafego = ifs
        .filter((i) => !interfaceVirtual(i))
        .sort((a, b) => (b.in_bps ?? 0) + (b.out_bps ?? 0) - ((a.in_bps ?? 0) + (a.out_bps ?? 0)))[0];
      return fisicaComTrafego?.if_index ?? ifs[0]?.if_index ?? null;
    });
    setCarregando(false);
  }

  useEffect(() => { setIfSelecionada(null); carregar(); /* eslint-disable-next-line */ }, [dispositivoId]);

  useEffect(() => {
    if (ifSelecionada == null) { setTrafego([]); return; }
    let ativo = true;
    api.snmpHistoricoInterface(dispositivoId, ifSelecionada, 60)
      .then((h) => ativo && setTrafego(h)).catch(() => ativo && setTrafego([]));
    return () => { ativo = false; };
  }, [dispositivoId, ifSelecionada, estado?.ultima_coleta_at]);

  async function coletarAgora() {
    setColetando(true);
    try { await api.coletarSnmp(dispositivoId); await new Promise((r) => setTimeout(r, 1300)); await carregar(); }
    finally { setColetando(false); }
  }

  const upCount = interfaces.filter((i) => i.oper_status === 1).length;
  const downCount = interfaces.filter((i) => i.oper_status === 2).length;
  const totalIn = interfaces.reduce((s, i) => s + (i.in_bps ?? 0), 0);
  const totalOut = interfaces.reduce((s, i) => s + (i.out_bps ?? 0), 0);
  const temRecursos = estado?.cpu_pct != null || estado?.memoria_pct != null || estado?.disco_pct != null;

  const dadosTrafego = useMemo(
    () => trafego.map((a) => ({ t: a.timestamp, download: a.in_bps ?? 0, upload: a.out_bps ?? 0 })),
    [trafego]
  );
  const dadosRecursos = useMemo(
    () => recursos.map((a) => ({ t: a.timestamp, cpu: a.cpu_pct ?? 0, mem: a.memoria_pct ?? 0, disco: a.disco_pct ?? 0 })),
    [recursos]
  );
  const ifsVisiveis = useMemo(() => {
    const base = mostrarTodas ? interfaces : interfaces.filter((i) => !interfaceVirtual(i));
    return [...base].sort((a, b) => (b.in_bps ?? 0) + (b.out_bps ?? 0) - ((a.in_bps ?? 0) + (a.out_bps ?? 0)));
  }, [interfaces, mostrarTodas]);
  const maxTraf = Math.max(1, ...ifsVisiveis.map((i) => (i.in_bps ?? 0) + (i.out_bps ?? 0)));

  const status = estado?.status ?? 'pendente';
  const badge = estado?.atrasada && status === 'ok' ? 'stale' : status;

  return (
    <section className="w-full min-w-0">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-mono mb-1">Dashboard SNMP</p>
          <h2 className="font-display text-xl font-semibold text-slate-50 leading-tight truncate">{dispositivo.nome}</h2>
          <p className="font-mono text-xs text-muted">
            {dispositivo.ip}
            {estado?.sys_descr && <span className="ml-2 opacity-70">· {estado.sys_descr.slice(0, 60)}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider ${CORES_STATUS[badge] || CORES_STATUS.pendente}`}>
            {ROTULO_STATUS[badge] || badge}
          </span>
          {podeOperar && (
            <button onClick={coletarAgora} disabled={coletando} className="btn-ghost text-xs disabled:opacity-50">
              {coletando ? 'coletando…' : 'Coletar agora'}
            </button>
          )}
        </div>
      </div>

      {status === 'sem_credencial' ? (
        <Card><p className="text-center font-mono text-xs text-muted py-6">
          Sem credencial SNMP. Configure a comunidade (v2c) ou o usuário (v3) na edição do dispositivo para ver CPU, memória, disco e tráfego.
        </p></Card>
      ) : carregando ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-40 animate-pulse rounded-2xl bg-white/[0.03] border border-white/[0.05]" />)}
        </div>
      ) : (
        <div className="space-y-3">
          {/* Linha 1 — recursos de hardware + sistema */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Card className="flex items-center justify-center">
              <Gauge pct={estado?.cpu_pct} titulo="CPU" legenda={estado?.cpu_cores ? `${estado.cpu_cores} núcleos` : temRecursos ? 'uso médio' : 'sem dados'} />
            </Card>
            <Card className="flex flex-col justify-center gap-4">
              <Barra titulo="Memória" pct={estado?.memoria_pct}
                detalhe={estado?.memoria_total_bytes ? `${formatarBytes(estado?.memoria_uso_bytes)} / ${formatarBytes(estado?.memoria_total_bytes)}` : 'sem dados'} />
              <Barra titulo="Disco" pct={estado?.disco_pct}
                detalhe={estado?.disco_total_bytes ? `${formatarBytes(estado?.disco_uso_bytes)} / ${formatarBytes(estado?.disco_total_bytes)}` : 'sem dados'} />
            </Card>
            <Card className="flex flex-col justify-center">
              <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-mono mb-2">Tráfego agora</p>
              <div className="flex items-baseline gap-1.5">
                <span className="w-2 h-2 rounded-full bg-teal-400" />
                <span className="font-mono text-lg font-semibold text-teal-400 tabular-nums">{formatarBps(totalIn)}</span>
                <span className="text-[10px] text-muted">down</span>
              </div>
              <div className="flex items-baseline gap-1.5 mt-1">
                <span className="w-2 h-2 rounded-full bg-teal-300" />
                <span className="font-mono text-lg font-semibold text-teal-300 tabular-nums">{formatarBps(totalOut)}</span>
                <span className="text-[10px] text-muted">up</span>
              </div>
            </Card>
            <Card className="flex flex-col justify-center gap-2.5">
              <div>
                <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-mono mb-0.5">Uptime</p>
                <p className="font-mono text-lg font-semibold text-slate-100">{formatarUptime(estado?.sys_uptime_ticks)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-mono mb-0.5">Interfaces</p>
                <p className="font-mono text-sm"><span className="text-teal-400">{upCount}↑</span> <span className="text-offline ml-1">{downCount}↓</span></p>
              </div>
            </Card>
          </div>

          {/* Linha 2 — tráfego (grande) + lista de interfaces */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <Card className="lg:col-span-2 min-w-0">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-mono">Tráfego · última hora</p>
                <select value={ifSelecionada ?? ''} onChange={(e) => setIfSelecionada(Number(e.target.value))}
                  className="input !w-auto !py-1 text-[11px]">
                  {interfaces.map((i) => <option key={i.if_index} value={i.if_index}>{nomeIf(i)}</option>)}
                </select>
              </div>
              <div style={{ height: 200 }}>
                {dadosTrafego.length === 0 ? (
                  <div className="flex h-full items-center justify-center font-mono text-[11px] text-muted">Sem amostras ainda (aguarde ao menos 2 coletas).</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={dadosTrafego} margin={{ top: 6, right: 8, bottom: 4, left: -6 }}>
                      <defs>
                        <linearGradient id="dl" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#2dd4bf" stopOpacity={0.35} /><stop offset="100%" stopColor="#2dd4bf" stopOpacity={0.02} /></linearGradient>
                        <linearGradient id="ul" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#5eead4" stopOpacity={0.3} /><stop offset="100%" stopColor="#5eead4" stopOpacity={0.02} /></linearGradient>
                      </defs>
                      <CartesianGrid stroke="rgba(148,163,184,0.08)" vertical={false} />
                      <XAxis dataKey="t" tickFormatter={horaEixo} tick={TICK} axisLine={false} tickLine={false} minTickGap={50} />
                      <YAxis tick={TICK} axisLine={false} tickLine={false} width={42} tickFormatter={eixoBps} />
                      <Tooltip contentStyle={{ background: 'rgba(11,11,15,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, fontFamily: 'IBM Plex Mono', fontSize: 11 }}
                        labelFormatter={(v) => new Date(String(v)).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        formatter={(val: any, nome: any) => [formatarBps(Number(val)), nome === 'download' ? 'Download' : 'Upload']} />
                      <Area type="monotone" dataKey="download" stroke="#2dd4bf" strokeWidth={2} fill="url(#dl)" isAnimationActive={false} dot={false} />
                      <Area type="monotone" dataKey="upload" stroke="#5eead4" strokeWidth={2} fill="url(#ul)" isAnimationActive={false} dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
            </Card>

            <Card className="min-w-0">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-mono">Interfaces {ifsVisiveis.length > 0 && `(${ifsVisiveis.length})`}</p>
                <button onClick={() => setMostrarTodas((v) => !v)} className="font-mono text-[10px] text-muted hover:text-slate-200">
                  {mostrarTodas ? 'só físicas' : 'mostrar todas'}
                </button>
              </div>
              <div className="max-h-[200px] overflow-y-auto space-y-1.5 pr-1">
                {ifsVisiveis.length === 0 ? (
                  <p className="font-mono text-[11px] text-muted py-4 text-center">Nenhuma interface.</p>
                ) : ifsVisiveis.map((i) => {
                  const total = (i.in_bps ?? 0) + (i.out_bps ?? 0);
                  const up = i.oper_status === 1;
                  const sel = i.if_index === ifSelecionada;
                  return (
                    <button key={i.if_index} onClick={() => setIfSelecionada(i.if_index)}
                      className={`w-full text-left rounded-lg px-2 py-1.5 transition-colors ${sel ? 'bg-signal-600/10' : 'hover:bg-white/[0.03]'}`}>
                      <div className="flex items-center justify-between gap-2 min-w-0">
                        <span className="flex items-center gap-1.5 min-w-0">
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${up ? 'bg-teal-400' : 'bg-offline'}`} />
                          <span className="font-mono text-[11px] text-slate-200 truncate">{nomeIf(i)}</span>
                        </span>
                        <span className="font-mono text-[10px] text-muted shrink-0">
                          <span className="text-teal-400">{formatarBps(i.in_bps)}</span> · <span className="text-teal-300">{formatarBps(i.out_bps)}</span>
                        </span>
                      </div>
                      <div className="mt-1 h-1 rounded-full bg-white/[0.05] overflow-hidden">
                        <div className="h-full rounded-full bg-gradient-to-r from-teal-500 to-teal-300" style={{ width: `${Math.round((total / maxTraf) * 100)}%` }} />
                      </div>
                    </button>
                  );
                })}
              </div>
            </Card>
          </div>

          {/* Linha 3 — recursos ao longo do tempo (se houver) */}
          {temRecursos && dadosRecursos.length > 0 && (
            <Card className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-mono mb-2">Recursos · CPU / Memória / Disco · última hora</p>
              <div style={{ height: 160 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={dadosRecursos} margin={{ top: 6, right: 8, bottom: 4, left: -18 }}>
                    <CartesianGrid stroke="rgba(148,163,184,0.08)" vertical={false} />
                    <XAxis dataKey="t" tickFormatter={horaEixo} tick={TICK} axisLine={false} tickLine={false} minTickGap={50} />
                    <YAxis domain={[0, 100]} tick={TICK} axisLine={false} tickLine={false} width={34} unit="%" />
                    <Tooltip contentStyle={{ background: 'rgba(11,11,15,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, fontFamily: 'IBM Plex Mono', fontSize: 11 }}
                      labelFormatter={(v) => new Date(String(v)).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      formatter={(val: any, nome: any) => [`${Number(val).toFixed(0)}%`, nome === 'cpu' ? 'CPU' : nome === 'mem' ? 'Memória' : 'Disco']} />
                    <Line type="monotone" dataKey="cpu" stroke="#2dd4bf" strokeWidth={2} dot={false} isAnimationActive={false} />
                    <Line type="monotone" dataKey="mem" stroke="#5eead4" strokeWidth={2} dot={false} isAnimationActive={false} />
                    <Line type="monotone" dataKey="disco" stroke="#0d9488" strokeWidth={2} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}
        </div>
      )}
    </section>
  );
}
