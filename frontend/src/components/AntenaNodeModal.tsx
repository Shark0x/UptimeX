import { useEffect, useState } from 'react';
import { AntenaNode } from '../apiAntenas';
import { IconePickerAntena } from './IconePickerAntena';
import { useToast } from './Toast';

export function AntenaNodeModal({
  aberto,
  onClose,
  onSalvar,
  nodeEditando,
}: {
  aberto: boolean;
  onClose: () => void;
  onSalvar: (payload: { label: string; tipo_visual: string }) => Promise<void>;
  nodeEditando?: AntenaNode | null;
}) {
  const [label, setLabel] = useState('');
  const [tipoVisual, setTipoVisual] = useState('torre');
  const [salvando, setSalvando] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (!aberto) return;
    setLabel(nodeEditando?.label || '');
    setTipoVisual(nodeEditando?.tipo_visual || 'torre');
  }, [aberto, nodeEditando]);

  if (!aberto) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim()) {
      toast.erro('Dê um nome para o item da topologia');
      return;
    }
    setSalvando(true);
    try {
      await onSalvar({ label: label.trim(), tipo_visual: tipoVisual });
      toast.sucesso(nodeEditando ? 'Item atualizado' : 'Item adicionado à topologia');
      onClose();
    } catch (err: any) {
      toast.erro(err.message || 'Erro ao salvar item');
    } finally {
      setSalvando(false);
    }
  }

  const eDecorativo = nodeEditando && !nodeEditando.antena_id;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-fade-in">
      <div className="glass-panel w-full max-w-md hud-corners border-signal-500/30 overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.08] bg-deep-900/60">
          <div>
            <h2 className="font-display text-lg font-bold text-slate-100">
              {nodeEditando ? 'Editar item da topologia' : 'Novo item decorativo'}
            </h2>
            <p className="text-xs font-mono text-muted">
              {nodeEditando
                ? eDecorativo
                  ? 'Marcador sem monitoramento — só nome e ícone.'
                  : 'Este item representa uma antena monitorada; renomear aqui também renomeia o equipamento.'
                : 'Marcador visual (torre, switch, site) sem IP monitorado.'}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 text-muted hover:text-slate-100">×</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-muted mb-1">Nome</label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Ex: Caixa de Passagem — Rua Central"
              className="input"
              required
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-muted mb-2">Ícone</label>
            <IconePickerAntena valor={tipoVisual} onSelecionar={setTipoVisual} />
          </div>
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-white/[0.08]">
            <button type="button" onClick={onClose} className="btn-ghost text-sm" disabled={salvando}>Cancelar</button>
            <button type="submit" className="btn-primary text-sm" disabled={salvando}>
              {salvando ? 'Salvando...' : nodeEditando ? 'Salvar Alterações' : '+ Adicionar Item'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
