import { useEffect, useMemo, useState } from 'react';
import { api, Dispositivo, Empresa, HeartbeatPayload, socket, saudeDispositivo } from '../api';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast';
import { StatusCard } from '../components/StatusCard';
import { EditarDispositivoModal } from '../components/EditarDispositivoModal';
import { TopologyMap } from '../components/TopologyMap';
import { HistoryTimeline } from '../components/HistoryTimeline';
import { AuditLog } from '../components/AuditLog';
import { DeviceDrawer } from '../components/DeviceDrawer';
import { LinksDedicados } from '../components/LinksDedicados';

type Aba = 'status' | 'topologia' | 'links' | 'historico' | 'auditoria';

function Kpi({ rotulo, valor, tom }: { rotulo: string; valor: string | number; tom?: 'offline' | 'warn' | 'online' }) {
  const cor = tom === 'offline' ? 'text-offline' : tom === 'warn' ? 'text-warn' : tom === 'online' ? 'text-online' : 'text-slate-100';
  return (
    <div className="flex items-baseline gap-2">
      <span className={`stat-number text-lg ${cor}`}>{valor}</span>
      <span className="text-[10px] uppercase tracking-widest text-muted font-mono">{rotulo}</span>
    </div>
  );
}

export function EmpresaPainel({ empresa, aoVoltar }: { empresa: Empresa; aoVoltar: () => void }) {
  const { isAdmin } = useAuth();
  const [aba, setAba] = useState<Aba>('status');
  const [dispositivos, setDispositivos] = useState<Dispositivo[]>([]);
  const [formAberto, setFormAberto] = useState(false);
  const [dispositivoEditando, setDispositivoEditando] = useState<Dispositivo | null>(null);
  const [drawerId, setDrawerId] = useState<number | null>(null);

  async function recarregar() {
    const lista = await api.listarDispositivos(empresa.id);
    setDispositivos(lista);
  }

  useEffect(() => {
    recarregar();
    socket.emit('entrar_empresa', empresa.id);

    // Heartbeats atualizam o estado em memória — sem refetch a cada ciclo de ping,
    // o que mantém o painel fluido mesmo com centenas de dispositivos.
    const aoVivo = (p: HeartbeatPayload) => {
      setDispositivos((prev) =>
        prev.map((d) =>
          d.id === p.dispositivoId
            ? {
                ...d,
                status_atual: (p.statusNovo ?? p.status ?? d.status_atual) as Dispositivo['status_atual'],
                latencia_ms: p.latenciaMs,
                perda_pct: p.perdaPct,
                ultima_verificacao: String(p.timestamp),
              }
            : d
        )
      );
    };
    socket.on('status_mudou', aoVivo);
    socket.on('heartbeat', aoVivo);

    return () => {
      socket.emit('sair_empresa', empresa.id);
      socket.off('status_mudou', aoVivo);
      socket.off('heartbeat', aoVivo);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresa.id]);

  const resumo = useMemo(() => {
    let online = 0, offline = 0, degradados = 0;
    let somaLat = 0, comLat = 0;
    dispositivos.forEach((d) => {
      const s = saudeDispositivo(d);
      if (s === 'offline') offline++;
      else if (s === 'degradado') { degradados++; online++; }
      else if (s === 'online') online++;
      if (d.latencia_ms !== null && d.status_atual === 'online') {
        somaLat += d.latencia_ms;
        comLat++;
      }
    });
    return {
      online, offline, degradados,
      latMedia: comLat > 0 ? Math.round(somaLat / comLat) : null,
    };
  }, [dispositivos]);

  // Drawer referencia o objeto vivo da lista — heartbeat atualiza o painel aberto também
  const dispositivoDrawer = drawerId !== null ? dispositivos.find((d) => d.id === drawerId) ?? null : null;

  const abas: { id: Aba; label: string }[] = [
    { id: 'status', label: 'Status' },
    { id: 'topologia', label: 'Topologia' },
    { id: 'links', label: 'Link Dedicado' },
    { id: 'historico', label: 'Histórico' },
    { id: 'auditoria', label: 'Auditoria' },
  ];

  return (
    <div className="flex flex-col h-full">
      <header className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={aoVoltar} className="text-muted hover:text-signal-400 text-sm font-mono transition-colors shrink-0">
            ← empresas
          </button>
          <h1 className="font-display text-xl font-semibold text-slate-100 truncate">{empresa.nome}</h1>
        </div>

        <div className="flex items-center gap-5 flex-wrap">
          <Kpi rotulo="online" valor={resumo.online} tom="online" />
          <Kpi rotulo="offline" valor={resumo.offline} tom={resumo.offline > 0 ? 'offline' : undefined} />
          <Kpi rotulo="degradados" valor={resumo.degradados} tom={resumo.degradados > 0 ? 'warn' : undefined} />
          <Kpi rotulo="latência média" valor={resumo.latMedia !== null ? `${resumo.latMedia}ms` : '—'} />
          {aba === 'status' && isAdmin && (
            <button onClick={() => setFormAberto(true)} className="btn-primary">
              + Novo dispositivo
            </button>
          )}
        </div>
      </header>

      <nav className="flex gap-1 mb-4 border-b border-white/[0.07]">
        {abas.map((a) => (
          <button
            key={a.id}
            onClick={() => setAba(a.id)}
            className={`px-4 py-2 text-sm font-display border-b-2 transition-all duration-150 ${
              aba === a.id
                ? 'border-signal-500 text-signal-400'
                : 'border-transparent text-muted hover:text-slate-300'
            }`}
          >
            {a.label}
          </button>
        ))}
      </nav>

      <div className="flex-1 min-h-0">
        {aba === 'status' && (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3 animate-fade-up">
            {dispositivos.map((d) => (
              <StatusCard
                key={d.id}
                d={d}
                onAbrir={() => setDrawerId(d.id)}
                onEditar={isAdmin ? () => setDispositivoEditando(d) : undefined}
              />
            ))}
            {dispositivos.length === 0 && (
              <div className="col-span-full glass-panel p-8 text-center">
                <p className="text-slate-300 font-display">Nenhum dispositivo monitorado ainda.</p>
                <p className="text-muted text-sm mt-1">
                  {isAdmin ? 'Cadastre o IP público fixo do cliente pra começar o monitoramento.' : 'Peça a um administrador pra cadastrar o primeiro dispositivo.'}
                </p>
              </div>
            )}
          </div>
        )}
        {aba === 'topologia' && (
          <TopologyMap
            empresaId={empresa.id}
            dispositivos={dispositivos}
            podeEditar={isAdmin}
            onAbrirDispositivo={(d) => setDrawerId(d.id)}
          />
        )}
        {aba === 'links' && <LinksDedicados empresaId={empresa.id} podeEditar={isAdmin} />}
        {aba === 'historico' && <HistoryTimeline dispositivos={dispositivos} />}
        {aba === 'auditoria' && <AuditLog />}
      </div>

      {dispositivoDrawer && (
        <DeviceDrawer dispositivo={dispositivoDrawer} onClose={() => setDrawerId(null)} />
      )}

      {formAberto && (
        <NovoDispositivoModal
          empresaId={empresa.id}
          onClose={() => setFormAberto(false)}
          onCriado={() => {
            setFormAberto(false);
            recarregar();
          }}
        />
      )}

      {dispositivoEditando && (
        <EditarDispositivoModal
          dispositivo={dispositivoEditando}
          onClose={() => setDispositivoEditando(null)}
          onSalvo={() => {
            setDispositivoEditando(null);
            recarregar();
          }}
        />
      )}
    </div>
  );
}

function NovoDispositivoModal({
  empresaId, onClose, onCriado,
}: {
  empresaId: number; onClose: () => void; onCriado: () => void;
}) {
  const toast = useToast();
  const [nome, setNome] = useState('');
  const [ip, setIp] = useState('');
  const [fabricante, setFabricante] = useState('generico');
  const [metodo, setMetodo] = useState<'snmp' | 'ping' | 'snmp+ping'>('ping');
  const [comunidade, setComunidade] = useState('public');
  const [porta, setPorta] = useState(161);
  const [intervalo, setIntervalo] = useState(30);
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    if (!nome.trim() || !ip.trim()) return;
    setSalvando(true);
    try {
      await api.criarDispositivo({
        empresa_id: empresaId, nome, ip, fabricante,
        metodo_monitoramento: metodo, comunidade_snmp: comunidade,
        porta_snmp: porta, intervalo_polling_seg: intervalo,
      });
      toast.sucesso(`Monitoramento de "${nome}" iniciado`);
      onCriado();
    } catch {
      toast.erro('Não foi possível cadastrar o dispositivo.');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-deep-950/80 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="glass-panel hud-corners p-6 w-full max-w-md animate-fade-up">
        <p className="eyebrow mb-1">Novo monitoramento</p>
        <h2 className="font-display font-semibold text-lg text-slate-100 mb-4">Cadastrar dispositivo</h2>
        <div className="space-y-3">
          <Campo label="Nome"><input value={nome} onChange={(e) => setNome(e.target.value)} className="input" placeholder="ex: Cliente ACME — Link principal" maxLength={150} /></Campo>
          <Campo label="IP público fixo"><input value={ip} onChange={(e) => setIp(e.target.value)} className="input" placeholder="200.150.10.1" maxLength={45} /></Campo>
          <Campo label="Fabricante">
            <select value={fabricante} onChange={(e) => setFabricante(e.target.value)} className="input">
              <option value="mikrotik">MikroTik</option>
              <option value="ubiquiti">Ubiquiti</option>
              <option value="cisco">Cisco</option>
              <option value="generico">Genérico / Outro</option>
            </select>
          </Campo>
          <Campo label="Método de monitoramento">
            <select value={metodo} onChange={(e) => setMetodo(e.target.value as any)} className="input">
              <option value="ping">Ping ICMP (recomendado pra clientes)</option>
              <option value="snmp+ping">SNMP + Ping</option>
              <option value="snmp">Somente SNMP</option>
            </select>
          </Campo>
          {metodo !== 'ping' && (
            <>
              <Campo label="Comunidade SNMP"><input value={comunidade} onChange={(e) => setComunidade(e.target.value)} className="input" maxLength={100} /></Campo>
              <Campo label="Porta SNMP"><input type="number" value={porta} onChange={(e) => setPorta(Number(e.target.value))} className="input" min={1} max={65535} /></Campo>
            </>
          )}
          <Campo label="Intervalo de verificação (segundos)">
            <input type="number" value={intervalo} onChange={(e) => setIntervalo(Number(e.target.value))} className="input" min={5} />
          </Campo>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="btn-ghost">Cancelar</button>
          <button onClick={salvar} disabled={salvando} className="btn-primary">
            {salvando ? 'Salvando...' : 'Iniciar monitoramento'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label-field">{label}</label>
      {children}
    </div>
  );
}
