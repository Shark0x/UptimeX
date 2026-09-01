import { useEffect, useState } from 'react';
import { AntenaEdge, AntenaNode, EstiloEnlace, FormatoEnlace, LadoEnlace, TipoEnlace } from '../apiAntenas';
import { PALETA_CORES_ENLACE } from './AntenaIcons';
import { useToast } from './Toast';

const TIPOS_ENLACE: { valor: TipoEnlace; rotulo: string }[] = [
  { valor: 'ptp_wireless', rotulo: 'PTP Wireless' },
  { valor: 'ptmp_wireless', rotulo: 'PTMP Wireless' },
  { valor: 'fibra_torre', rotulo: 'Fibra Óptica' },
  { valor: 'cabo_poe', rotulo: 'Cabo PoE' },
  { valor: 'backup_radio', rotulo: 'Rádio Backup' },
];

// Espessuras predefinidas: Fina usa null (o padrão automático de 1.8px)
const ESPESSURAS: { rotulo: string; valor: number | null }[] = [
  { rotulo: 'Fina', valor: null },
  { rotulo: 'Média', valor: 3 },
  { rotulo: 'Grossa', valor: 5 },
];

const ESTILOS: { rotulo: string; valor: EstiloEnlace | null }[] = [
  { rotulo: 'Auto', valor: null },
  { rotulo: 'Sólida', valor: 'solida' },
  { rotulo: 'Tracejada', valor: 'tracejada' },
  { rotulo: 'Pontilhada', valor: 'pontilhada' },
];

const FLUXOS: { rotulo: string; valor: boolean | null }[] = [
  { rotulo: 'Auto', valor: null },
  { rotulo: 'Ligado', valor: true },
  { rotulo: 'Desligado', valor: false },
];

// Traçado da linha. "Raio" = zigue-zague pra sinalizar link wireless (ref. The Dude).
const FORMATOS: { rotulo: string; valor: FormatoEnlace }[] = [
  { rotulo: 'Reta', valor: 'reta' },
  { rotulo: 'Curva', valor: 'curva' },
  { rotulo: 'Raio', valor: 'raio' },
];

// Lado (borda) de ancoragem de cada ponta. "Auto" escolhe o mais próximo.
const LADOS: { rotulo: string; valor: LadoEnlace }[] = [
  { rotulo: 'Auto', valor: 'auto' },
  { rotulo: 'Topo', valor: 'topo' },
  { rotulo: 'Base', valor: 'base' },
  { rotulo: 'Esquerda', valor: 'esq' },
  { rotulo: 'Direita', valor: 'dir' },
];

export interface EnlacePayload {
  origem_node_id: number;
  destino_node_id: number;
  tipo_enlace: TipoEnlace;
  label?: string;
  cor?: string | null;
  curvo?: boolean;
  frequencia?: string;
  distancia_km?: number | null;
  capacidade_mbps?: number | null;
  espessura?: number | null;
  estilo?: EstiloEnlace | null;
  animado?: boolean | null;
  origem_lado?: LadoEnlace | null;
  destino_lado?: LadoEnlace | null;
  formato?: FormatoEnlace | null;
  mostrar_label?: boolean;
}

export function AntenaLinkModal({
  aberto, onClose, nodes, onCriarEnlace, onEditarEnlace, origemPreDefinida, destinoPreDefinido, enlaceEditando,
}: {
  aberto: boolean;
  onClose: () => void;
  nodes: AntenaNode[];
  onCriarEnlace: (payload: EnlacePayload) => Promise<void>;
  onEditarEnlace?: (id: number, payload: Partial<EnlacePayload>) => Promise<void>;
  origemPreDefinida?: number | null;
  destinoPreDefinido?: number | null;
  enlaceEditando?: AntenaEdge | null;
}) {
  const [origemId, setOrigemId] = useState('');
  const [destinoId, setDestinoId] = useState('');
  const [label, setLabel] = useState('');
  const [tipoEnlace, setTipoEnlace] = useState<TipoEnlace>('ptp_wireless');
  const [cor, setCor] = useState<string | null>(null);
  const [formato, setFormato] = useState<FormatoEnlace>('reta');
  const [origemLado, setOrigemLado] = useState<LadoEnlace>('auto');
  const [destinoLado, setDestinoLado] = useState<LadoEnlace>('auto');
  const [mostrarLabel, setMostrarLabel] = useState(true);
  const [espessura, setEspessura] = useState<number | null>(null);
  const [estilo, setEstilo] = useState<EstiloEnlace | null>(null);
  const [animado, setAnimado] = useState<boolean | null>(null);
  const [frequencia, setFrequencia] = useState('');
  const [distanciaKm, setDistanciaKm] = useState('');
  const [capacidadeMbps, setCapacidadeMbps] = useState('');
  const [salvando, setSalvando] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (!aberto) return;
    if (enlaceEditando) {
      setOrigemId(String(enlaceEditando.origem_node_id));
      setDestinoId(String(enlaceEditando.destino_node_id));
      setLabel(enlaceEditando.label || '');
      setTipoEnlace(enlaceEditando.tipo_enlace);
      setCor(enlaceEditando.cor || null);
      setFormato(enlaceEditando.formato ?? (enlaceEditando.curvo ? 'curva' : 'reta'));
      setOrigemLado(enlaceEditando.origem_lado ?? 'auto');
      setDestinoLado(enlaceEditando.destino_lado ?? 'auto');
      setMostrarLabel(enlaceEditando.mostrar_label ?? true);
      setEspessura(enlaceEditando.espessura ?? null);
      setEstilo(enlaceEditando.estilo ?? null);
      setAnimado(enlaceEditando.animado ?? null);
      setFrequencia(enlaceEditando.frequencia || '');
      setDistanciaKm(enlaceEditando.distancia_km != null ? String(enlaceEditando.distancia_km) : '');
      setCapacidadeMbps(enlaceEditando.capacidade_mbps != null ? String(enlaceEditando.capacidade_mbps) : '');
    } else {
      setOrigemId(origemPreDefinida ? String(origemPreDefinida) : String(nodes[0]?.id ?? ''));
      setDestinoId(destinoPreDefinido ? String(destinoPreDefinido) : String(nodes[1]?.id ?? ''));
      setLabel('');
      setTipoEnlace('ptp_wireless');
      setCor(null);
      setFormato('reta');
      setOrigemLado('auto');
      setDestinoLado('auto');
      setMostrarLabel(true);
      setEspessura(null);
      setEstilo(null);
      setAnimado(null);
      setFrequencia('');
      setDistanciaKm('');
      setCapacidadeMbps('');
    }
  }, [aberto, enlaceEditando, origemPreDefinida, destinoPreDefinido, nodes]);

  if (!aberto) return null;

  const origemNode = nodes.find((n) => n.id === Number(origemId));
  const destinoNode = nodes.find((n) => n.id === Number(destinoId));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!enlaceEditando && (!origemId || !destinoId || origemId === destinoId)) {
      toast.erro('Selecione duas antenas diferentes');
      return;
    }
    setSalvando(true);
    try {
      const payload: EnlacePayload = {
        origem_node_id: Number(origemId),
        destino_node_id: Number(destinoId),
        tipo_enlace: tipoEnlace,
        label: label.trim() || undefined,
        cor,
        // curvo continua sendo enviado (derivado) pra compatibilidade; formato é a
        // fonte de verdade do traçado (reta/curva/raio).
        curvo: formato === 'curva',
        formato,
        origem_lado: origemLado,
        destino_lado: destinoLado,
        mostrar_label: mostrarLabel,
        espessura,
        estilo,
        animado,
        frequencia: frequencia.trim() || undefined,
        distancia_km: distanciaKm ? Number(distanciaKm) : null,
        capacidade_mbps: capacidadeMbps ? Number(capacidadeMbps) : null,
      };
      if (enlaceEditando && onEditarEnlace) {
        await onEditarEnlace(enlaceEditando.id, payload);
        toast.sucesso('Enlace atualizado');
      } else {
        await onCriarEnlace(payload);
        toast.sucesso('Interligação criada');
      }
      onClose();
    } catch (err: any) {
      toast.erro(err.message || 'Erro ao salvar interligação');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-fade-in">
      <div className="glass-panel w-full max-w-lg max-h-[90vh] flex flex-col hud-corners border-signal-500/30 overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.08] bg-deep-900/60">
          <div>
            <h2 className="font-display text-lg font-bold text-slate-100">
              {enlaceEditando ? 'Editar interligação' : 'Criar interligação'}
            </h2>
            <p className="text-xs font-mono text-muted">
              {enlaceEditando ? 'Nome, cor e formato da linha.' : 'Escolha os dois equipamentos conectados.'}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 text-muted hover:text-slate-100">×</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto flex-1">
          {enlaceEditando ? (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-xs font-mono text-slate-300">
              <span className="truncate">{origemNode?.label || `Nó #${enlaceEditando.origem_node_id}`}</span>
              <span className="text-muted shrink-0">⇄</span>
              <span className="truncate text-right">{destinoNode?.label || `Nó #${enlaceEditando.destino_node_id}`}</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="block text-xs font-mono uppercase tracking-wider text-muted">Origem
                <select value={origemId} onChange={(e) => setOrigemId(e.target.value)} className="input text-xs mt-1" required>
                  <option value="">Selecione...</option>{nodes.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
                </select>
              </label>
              <label className="block text-xs font-mono uppercase tracking-wider text-muted">Destino
                <select value={destinoId} onChange={(e) => setDestinoId(e.target.value)} className="input text-xs mt-1" required>
                  <option value="">Selecione...</option>{nodes.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
                </select>
              </label>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-mono uppercase tracking-wider text-muted mb-1">Nome do enlace</label>
              <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ex: Backbone Norte" className="input" />
            </div>
            <div>
              <label className="block text-xs font-mono uppercase tracking-wider text-muted mb-1">Tipo</label>
              <select value={tipoEnlace} onChange={(e) => setTipoEnlace(e.target.value as TipoEnlace)} className="input">
                {TIPOS_ENLACE.map((t) => <option key={t.valor} value={t.valor}>{t.rotulo}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-muted mb-2">Cor da linha</label>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setCor(null)}
                title="Cor automática (segue o status)"
                className={`w-7 h-7 rounded-full border-2 flex items-center justify-center text-[9px] font-mono ${cor === null ? 'border-signal-500 scale-110' : 'border-white/20'}`}
                style={{ background: 'conic-gradient(#2FD771, #FFB224, #FF2B3A, #2FD771)' }}
              >
                {cor === null && <span className="w-2 h-2 rounded-full bg-deep-950" />}
              </button>
              {PALETA_CORES_ENLACE.map((c) => (
                <button
                  type="button"
                  key={c.valor}
                  onClick={() => setCor(c.valor)}
                  title={c.nome}
                  className={`w-7 h-7 rounded-full border-2 transition-transform ${cor === c.valor ? 'border-signal-500 scale-110' : 'border-white/20 hover:scale-105'}`}
                  style={{ backgroundColor: c.valor }}
                />
              ))}
              <input
                type="color"
                value={cor || '#2FD771'}
                onChange={(e) => setCor(e.target.value)}
                title="Cor customizada"
                className="w-7 h-7 rounded-full border-2 border-white/20 bg-transparent cursor-pointer p-0 overflow-hidden"
              />
            </div>
            <p className="text-[10px] font-mono text-muted mt-1.5">Quedas e degradação sempre aparecem em vermelho/âmbar, mesmo com cor customizada.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-mono uppercase tracking-wider text-muted mb-2">Formato da linha</label>
              <div className="inline-flex rounded-lg border border-white/10 overflow-hidden">
                {FORMATOS.map((op, i) => (
                  <button
                    type="button"
                    key={op.valor}
                    onClick={() => setFormato(op.valor)}
                    title={op.valor === 'raio' ? 'Relâmpago ⚡ pra links wireless (rádio/PtP/PtMP)' : undefined}
                    className={`px-3 py-1.5 text-xs font-mono ${i > 0 ? 'border-l border-white/10' : ''} ${formato === op.valor ? 'bg-signal-600/20 text-signal-400' : 'text-muted hover:text-slate-200'}`}
                  >
                    {op.rotulo}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs font-mono uppercase tracking-wider text-muted mb-2">Espessura</label>
              <div className="inline-flex rounded-lg border border-white/10 overflow-hidden">
                {ESPESSURAS.map((op, i) => (
                  <button
                    type="button"
                    key={op.rotulo}
                    onClick={() => setEspessura(op.valor)}
                    className={`px-3 py-1.5 text-xs font-mono ${i > 0 ? 'border-l border-white/10' : ''} ${espessura === op.valor ? 'bg-signal-600/20 text-signal-400' : 'text-muted hover:text-slate-200'}`}
                  >
                    {op.rotulo}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-mono uppercase tracking-wider text-muted mb-2">Estilo do traço</label>
              <div className="inline-flex flex-wrap rounded-lg border border-white/10 overflow-hidden">
                {ESTILOS.map((op, i) => (
                  <button
                    type="button"
                    key={op.rotulo}
                    onClick={() => setEstilo(op.valor)}
                    className={`px-3 py-1.5 text-xs font-mono ${i > 0 ? 'border-l border-white/10' : ''} ${estilo === op.valor ? 'bg-signal-600/20 text-signal-400' : 'text-muted hover:text-slate-200'}`}
                  >
                    {op.rotulo}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs font-mono uppercase tracking-wider text-muted mb-2">Fluxo animado</label>
              <div className="inline-flex rounded-lg border border-white/10 overflow-hidden">
                {FLUXOS.map((op, i) => (
                  <button
                    type="button"
                    key={op.rotulo}
                    onClick={() => setAnimado(op.valor)}
                    className={`px-3 py-1.5 text-xs font-mono ${i > 0 ? 'border-l border-white/10' : ''} ${animado === op.valor ? 'bg-signal-600/20 text-signal-400' : 'text-muted hover:text-slate-200'}`}
                  >
                    {op.rotulo}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-mono uppercase tracking-wider text-muted mb-2">Saída (origem)</label>
              <select value={origemLado} onChange={(e) => setOrigemLado(e.target.value as LadoEnlace)} className="input text-xs" title="Borda do nó de origem de onde a linha sai">
                {LADOS.map((l) => <option key={l.valor} value={l.valor}>{l.rotulo}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-mono uppercase tracking-wider text-muted mb-2">Chegada (destino)</label>
              <select value={destinoLado} onChange={(e) => setDestinoLado(e.target.value as LadoEnlace)} className="input text-xs" title="Borda do nó de destino onde a linha chega">
                {LADOS.map((l) => <option key={l.valor} value={l.valor}>{l.rotulo}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-mono uppercase tracking-wider text-muted mb-2">Rótulo na linha</label>
              <div className="inline-flex rounded-lg border border-white/10 overflow-hidden">
                <button type="button" onClick={() => setMostrarLabel(true)} className={`px-3 py-1.5 text-xs font-mono ${mostrarLabel ? 'bg-signal-600/20 text-signal-400' : 'text-muted hover:text-slate-200'}`}>Mostrar</button>
                <button type="button" onClick={() => setMostrarLabel(false)} className={`px-3 py-1.5 text-xs font-mono border-l border-white/10 ${!mostrarLabel ? 'bg-signal-600/20 text-signal-400' : 'text-muted hover:text-slate-200'}`}>Ocultar</button>
              </div>
            </div>
          </div>
          <p className="-mt-2 text-[10px] font-mono text-muted">
            "Auto" ancora no lado mais próximo do outro equipamento. Fixe topo/base/esquerda/direita quando quiser controlar o desenho.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-mono uppercase tracking-wider text-muted mb-1">Frequência</label>
              <input type="text" value={frequencia} onChange={(e) => setFrequencia(e.target.value)} placeholder="Ex: 5.8 GHz" className="input font-mono" />
            </div>
            <div>
              <label className="block text-xs font-mono uppercase tracking-wider text-muted mb-1">Distância (km)</label>
              <input type="number" step="0.1" value={distanciaKm} onChange={(e) => setDistanciaKm(e.target.value)} placeholder="Ex: 3.2" className="input font-mono" />
            </div>
            <div>
              <label className="block text-xs font-mono uppercase tracking-wider text-muted mb-1">Capacidade (Mbps)</label>
              <input type="number" value={capacidadeMbps} onChange={(e) => setCapacidadeMbps(e.target.value)} placeholder="Ex: 850" className="input font-mono" />
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-white/[0.08]">
            <button type="button" onClick={onClose} className="btn-ghost text-sm" disabled={salvando}>Cancelar</button>
            <button type="submit" className="btn-primary text-sm" disabled={salvando}>
              {salvando ? 'Salvando...' : enlaceEditando ? 'Salvar Alterações' : 'Conectar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
