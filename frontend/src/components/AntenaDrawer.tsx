import { useState, useEffect } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AntenaWireless,
  AntenaMetrica,
  antenasApi,
  socket,
} from '../apiAntenas';
import { iconeAntenaPorTipo, corFabricante } from './AntenaIcons';
import { useToast } from './Toast';

type Janela = 60 | 360 | 1440;

const JANELAS: { valor: Janela; rotulo: string }[] = [
  { valor: 60, rotulo: '1h' },
  { valor: 360, rotulo: '6h' },
  { valor: 1440, rotulo: '24h' },
];

function horaCurta(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

function TooltipGrafico({ active, payload, label, unidade }: any) {
  if (!active || !payload?.length) return null;
  const v = payload[0].value;
  return (
    <div className="glass-panel px-3 py-2 !rounded-lg text-xs font-mono border-white/20">
      <p className="text-muted">{horaCurta(label)}</p>
      <p className="text-slate-100 font-semibold mt-0.5">
        {v === null || v === undefined ? 'Sem resposta' : `${Number(v).toFixed(unidade === '%' ? 1 : 0)} ${unidade}`}
      </p>
    </div>
  );
}

function StatCard({ rotulo, valor, sub }: { rotulo: string; valor: React.ReactNode; sub?: string }) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-deep-900/80 p-3">
      <p className="text-[9px] uppercase tracking-[0.16em] text-muted font-mono mb-1">{rotulo}</p>
      <div className="font-display text-base font-semibold text-slate-100">{valor}</div>
      {sub && <p className="text-[10px] text-muted font-mono mt-0.5">{sub}</p>}
    </div>
  );
}

export function AntenaDrawer({
  antena,
  onClose,
  onEditar,
  onRemover,
}: {
  antena: AntenaWireless;
  onClose: () => void;
  onEditar?: (a: AntenaWireless) => void;
  onRemover?: (id: number) => void;
}) {
  const [janela, setJanela] = useState<Janela>(60);
  const [metricas, setMetricas] = useState<AntenaMetrica[]>([]);
  const [antenaViva, setAntenaViva] = useState<AntenaWireless>(antena);
  const [testandoPing, setTestandoPing] = useState(false);
  const toast = useToast();

  useEffect(() => {
    setAntenaViva(antena);
  }, [antena]);

  useEffect(() => {
    antenasApi.metricasAntena(antena.id, janela).then(setMetricas).catch(() => setMetricas([]));
  }, [antena.id, janela]);

  // Atualização em tempo real via socket
  useEffect(() => {
    const aoReceberHeartbeat = (p: any) => {
      if (p.antenaId !== antena.id) return;
      setAntenaViva((prev) => ({
        ...prev,
        status_atual: p.status || prev.status_atual,
        latencia_ms: p.latenciaMs,
        perda_pct: p.perdaPct,
        ultima_verificacao: p.timestamp,
      }));

      if (p.perdaPct !== null && p.perdaPct !== undefined) {
        setMetricas((prev) => [
          ...prev.slice(-1000),
          { latencia_ms: p.latenciaMs, perda_pct: p.perdaPct, timestamp: p.timestamp },
        ]);
      }
    };

    socket.on('antena:heartbeat', aoReceberHeartbeat);
    socket.on('antena:status_mudou', aoReceberHeartbeat);

    return () => {
      socket.off('antena:heartbeat', aoReceberHeartbeat);
      socket.off('antena:status_mudou', aoReceberHeartbeat);
    };
  }, [antena.id]);

  // Fechar com tecla ESC
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [onClose]);

  async function handlePingManual() {
    setTestandoPing(true);
    try {
      const res = await antenasApi.pingInstantaneo(antena.id);
      if (res.alcancavel) {
        toast.sucesso(`Ping OK: ${res.latenciaMs ? `${Math.round(res.latenciaMs)}ms` : 'Respondendo'}`);
      } else {
        toast.erro('Equipamento não respondeu ao ping (100% perda)');
      }
    } catch (err: any) {
      toast.erro(err.message || 'Erro ao executar ping');
    } finally {
      setTestandoPing(false);
    }
  }

  const Icone = iconeAntenaPorTipo(antenaViva.tipo_wireless || 'antena_ptp');
  const corFab = corFabricante(antenaViva.fabricante);
  const isOnline = antenaViva.status_atual === 'online';

  return (
    <aside
      className="fixed inset-y-0 right-0 z-40 w-full max-w-[440px] flex flex-col
        bg-gradient-to-b from-deep-900/95 to-deep-950/95 backdrop-blur-2xl
        border-l border-white/10 shadow-glass animate-drawer-in overflow-hidden"
      role="dialog"
      aria-label={`Detalhes de ${antenaViva.nome}`}
    >
      {/* Header */}
      <div className="p-6 border-b border-white/[0.08] bg-deep-900/70">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3.5 min-w-0">
            <span className={`w-11 h-11 rounded-xl flex items-center justify-center border ${corFab.bg} ${corFab.borda} ${corFab.texto}`}>
              <Icone width={24} height={24} />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase font-bold border ${corFab.badge}`}>
                  {antenaViva.fabricante}
                </span>
                <span className="text-[10px] font-mono text-muted uppercase">
                  {antenaViva.tipo_wireless}
                </span>
              </div>
              <h2 className="font-display text-lg font-bold text-slate-100 truncate mt-0.5" title={antenaViva.nome}>
                {antenaViva.nome}
              </h2>
              <p className="font-mono text-xs text-signal-400 font-medium">{antenaViva.ip}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handlePingManual}
              disabled={testandoPing}
              className="btn-primary text-xs !py-1.5 !px-3 flex items-center gap-1.5"
              title="Disparar ping ICMP imediato"
            >
              <svg className={`w-3.5 h-3.5 ${testandoPing ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <circle cx="12" cy="12" r="10" />
                <path d="M12 6v6l4 2" />
              </svg>
              <span>{testandoPing ? 'Pingando...' : 'Testar Ping'}</span>
            </button>
            <button
              onClick={onClose}
              className="p-2 text-muted hover:text-slate-100 hover:bg-white/10 rounded-lg transition-colors"
            >
              ✕
            </button>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="p-6 overflow-y-auto space-y-6 flex-1">
        {/* KPI Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard
            rotulo="Status Atual"
            valor={
              <span className={`flex items-center gap-1.5 uppercase text-sm ${isOnline ? 'text-online' : 'text-offline'}`}>
                <span className={`w-2 h-2 rounded-full ${isOnline ? 'status-dot-online' : 'status-dot-offline'}`} />
                {antenaViva.status_atual}
              </span>
            }
          />
          <StatCard
            rotulo="Latência Média"
            valor={
              <span className="font-mono text-cyan-400">
                {antenaViva.latencia_ms !== null && antenaViva.latencia_ms !== undefined
                  ? `${Math.round(antenaViva.latencia_ms)} ms`
                  : '—'}
              </span>
            }
          />
          <StatCard
            rotulo="Perda Pacotes"
            valor={
              <span className={`font-mono ${antenaViva.perda_pct && antenaViva.perda_pct > 0 ? 'text-offline' : 'text-online'}`}>
                {antenaViva.perda_pct !== null && antenaViva.perda_pct !== undefined ? `${antenaViva.perda_pct.toFixed(0)}%` : '—'}
              </span>
            }
          />
          <StatCard
            rotulo="Polling ICMP"
            valor={<span className="font-mono text-slate-300">{antenaViva.intervalo_polling_seg}s</span>}
          />
        </div>

        {/* Informações Técnicas de Rádio */}
        <div className="glass-panel p-4 space-y-3">
          <h3 className="text-xs font-mono uppercase tracking-wider text-muted font-bold flex items-center gap-2">
            <span>// Parâmetros de Rádio & Hardware</span>
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs font-mono">
            <div>
              <span className="text-muted block text-[10px]">Modelo:</span>
              <span className="text-slate-200">{antenaViva.modelo || 'Não especificado'}</span>
            </div>
            <div>
              <span className="text-muted block text-[10px]">Frequência:</span>
              <span className="text-cyan-400">
                {antenaViva.frequencia_mhz ? `${(antenaViva.frequencia_mhz / 1000).toFixed(2)} GHz` : '—'}
              </span>
            </div>
            <div>
              <span className="text-muted block text-[10px]">Largura Canal:</span>
              <span className="text-slate-200">
                {antenaViva.largura_canal_mhz ? `${antenaViva.largura_canal_mhz} MHz` : '—'}
              </span>
            </div>
            <div>
              <span className="text-muted block text-[10px]">SSID:</span>
              <span className="text-slate-200">{antenaViva.ssid || '—'}</span>
            </div>
            <div>
              <span className="text-muted block text-[10px]">Sinal Alvo:</span>
              <span className="text-slate-200">
                {antenaViva.sinal_esperado_dbm ? `${antenaViva.sinal_esperado_dbm} dBm` : '—'}
              </span>
            </div>
            <div>
              <span className="text-muted block text-[10px]">Última Checagem:</span>
              <span className="text-slate-400">
                {antenaViva.ultima_verificacao ? horaCurta(antenaViva.ultima_verificacao) : '—'}
              </span>
            </div>
          </div>
        </div>

        {/* Gráfico de Telemetria de Latência */}
        <div className="glass-panel p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-mono uppercase tracking-wider text-muted font-bold flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-cyan-400" />
              <span>Latência ICMP (ms)</span>
            </h3>
            <div className="flex gap-1 bg-deep-900 rounded-lg p-0.5 border border-white/5">
              {JANELAS.map((j) => (
                <button
                  key={j.valor}
                  onClick={() => setJanela(j.valor)}
                  className={`px-2 py-0.5 rounded text-[10px] font-mono transition-colors ${
                    janela === j.valor ? 'bg-signal-600 text-white font-bold' : 'text-muted hover:text-slate-200'
                  }`}
                >
                  {j.rotulo}
                </button>
              ))}
            </div>
          </div>

          <div className="h-44 w-full">
            {metricas.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={metricas}>
                  <defs>
                    <linearGradient id="gradienteLatencia" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#00E5FF" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#00E5FF" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="timestamp" tickFormatter={horaCurta} stroke="#82828E" fontSize={10} />
                  <YAxis stroke="#82828E" fontSize={10} unit="ms" />
                  <Tooltip content={<TooltipGrafico unidade="ms" />} />
                  <Area
                    type="monotone"
                    dataKey="latencia_ms"
                    stroke="#00E5FF"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#gradienteLatencia)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs font-mono text-muted">
                Aguardando amostras de telemetria...
              </div>
            )}
          </div>
        </div>

        {/* Gráfico de Perda de Pacotes */}
        <div className="glass-panel p-4 space-y-3">
          <h3 className="text-xs font-mono uppercase tracking-wider text-muted font-bold flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-offline" />
            <span>Perda de Pacotes (%)</span>
          </h3>

          <div className="h-32 w-full">
            {metricas.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={metricas}>
                  <defs>
                    <linearGradient id="gradientePerda" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#FF2B3A" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#FF2B3A" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="timestamp" tickFormatter={horaCurta} stroke="#82828E" fontSize={10} />
                  <YAxis stroke="#82828E" fontSize={10} domain={[0, 100]} unit="%" />
                  <Tooltip content={<TooltipGrafico unidade="%" />} />
                  <Area
                    type="stepAfter"
                    dataKey="perda_pct"
                    stroke="#FF2B3A"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#gradientePerda)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs font-mono text-muted">
                Sem histórico de perda no período.
              </div>
            )}
          </div>
        </div>

        {/* Ações de Edição e Remoção */}
        <div className="flex items-center justify-between pt-2">
          {onRemover && (
            <button
              onClick={() => onRemover(antenaViva.id)}
              className="text-xs font-mono text-offline/80 hover:text-offline hover:underline transition-colors"
            >
              Excluir esta antena
            </button>
          )}
          {onEditar && (
            <button onClick={() => onEditar(antenaViva)} className="btn-ghost text-xs">
              Editar Configurações
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
