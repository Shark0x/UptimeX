import { useCallback, useEffect, useState } from 'react';
import { AntenaPreset, antenasApi } from '../apiAntenas';
import { useAuth } from '../auth/AuthContext';
import { useToast } from './Toast';

/**
 * Gerenciador de presets (versões salvas) da topologia de antenas.
 * - "Salvar preset": tira um retrato do board ao vivo e guarda com um nome.
 * - "Ativar TV": escolhe qual preset a Visualização TV mostra (congelado).
 * - "Carregar": traz um preset de volta pro editor (substitui o board ao vivo).
 * Leitura pra todos; ações de escrita só admin/operador (visualizador só vê a lista).
 */
export function AntenaPresets({ onAplicado }: { onAplicado: () => void }) {
  const { usuario } = useAuth();
  const podeEditar = usuario?.role === 'admin' || usuario?.role === 'operador';
  const toast = useToast();

  const [aberto, setAberto] = useState(false);
  const [presets, setPresets] = useState<AntenaPreset[]>([]);
  const [nome, setNome] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [confirmando, setConfirmando] = useState<{ id: number; acao: 'carregar' | 'excluir' } | null>(null);
  const [renomeando, setRenomeando] = useState<{ id: number; nome: string } | null>(null);

  const recarregar = useCallback(async () => {
    try {
      setPresets(await antenasApi.listarPresets());
    } catch {
      /* backend pode estar reiniciando */
    }
  }, []);

  useEffect(() => {
    if (aberto) recarregar();
  }, [aberto, recarregar]);

  async function salvar() {
    const n = nome.trim();
    if (!n) return;
    setSalvando(true);
    try {
      await antenasApi.criarPreset(n);
      toast.sucesso(`Preset "${n}" salvo`);
      setNome('');
      await recarregar();
    } catch (e: any) {
      toast.erro(e.message || 'Falha ao salvar preset');
    } finally {
      setSalvando(false);
    }
  }

  async function ativar(p: AntenaPreset) {
    try {
      await antenasApi.ativarPreset(p.id);
      toast.sucesso(`"${p.nome}" ativado na TV`);
      await recarregar();
    } catch (e: any) {
      toast.erro(e.message || 'Falha ao ativar preset');
    }
  }

  async function carregar(p: AntenaPreset) {
    try {
      await antenasApi.carregarPreset(p.id);
      toast.sucesso(`"${p.nome}" carregado no editor`);
      setConfirmando(null);
      onAplicado();
    } catch (e: any) {
      toast.erro(e.message || 'Falha ao carregar preset');
    }
  }

  async function excluir(p: AntenaPreset) {
    try {
      await antenasApi.removerPreset(p.id);
      toast.sucesso('Preset removido');
      setConfirmando(null);
      await recarregar();
    } catch (e: any) {
      toast.erro(e.message || 'Falha ao remover preset');
    }
  }

  async function confirmarRenomear() {
    if (!renomeando) return;
    const n = renomeando.nome.trim();
    if (!n) return;
    try {
      await antenasApi.renomearPreset(renomeando.id, n);
      setRenomeando(null);
      await recarregar();
    } catch (e: any) {
      toast.erro(e.message || 'Falha ao renomear preset');
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setAberto((v) => !v)}
        className="btn-ghost text-xs !py-2 !px-3.5 flex items-center gap-1.5 border border-white/10 hover:border-white/25"
        aria-expanded={aberto}
      >
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
        Presets
      </button>

      {aberto && (
        <div className="absolute right-0 mt-2 w-[22rem] max-w-[90vw] z-50 bg-deep-900 border border-white/10 rounded-xl shadow-glass p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="eyebrow">Presets da topologia</p>
            <button onClick={() => setAberto(false)} className="text-muted hover:text-slate-200 text-lg leading-none" aria-label="Fechar">×</button>
          </div>

          {podeEditar && (
            <div className="flex gap-1.5 mb-3">
              <input
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && salvar()}
                placeholder="Nome do novo preset"
                maxLength={120}
                className="flex-1 bg-deep-900 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-slate-100 placeholder:text-muted focus:border-signal-500/50 outline-none"
              />
              <button onClick={salvar} disabled={salvando || !nome.trim()} className="btn-primary text-xs !py-1.5 !px-3 disabled:opacity-40">
                Salvar
              </button>
            </div>
          )}

          <div className="max-h-72 overflow-y-auto flex flex-col gap-1.5">
            {presets.length === 0 && (
              <p className="text-xs text-muted font-mono py-3 text-center">Nenhum preset salvo ainda.</p>
            )}
            {presets.map((p) => (
              <div key={p.id} className={`rounded-lg border px-2.5 py-2 ${p.ativo_tv ? 'border-online/40 bg-online/5' : 'border-white/8 bg-white/[0.02]'}`}>
                {renomeando?.id === p.id ? (
                  <div className="flex gap-1.5">
                    <input
                      value={renomeando.nome}
                      onChange={(e) => setRenomeando({ id: p.id, nome: e.target.value })}
                      onKeyDown={(e) => { if (e.key === 'Enter') confirmarRenomear(); if (e.key === 'Escape') setRenomeando(null); }}
                      autoFocus
                      maxLength={120}
                      className="flex-1 bg-deep-900 border border-white/10 rounded px-2 py-1 text-sm text-slate-100 outline-none focus:border-signal-500/50"
                    />
                    <button onClick={confirmarRenomear} className="text-online text-xs font-mono px-1.5">ok</button>
                    <button onClick={() => setRenomeando(null)} className="text-muted text-xs font-mono px-1.5">cancelar</button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm text-slate-100 font-display font-semibold truncate flex items-center gap-1.5">
                        {p.ativo_tv && <span className="w-1.5 h-1.5 rounded-full bg-online shrink-0" title="Ativo na TV" />}
                        {p.nome}
                      </p>
                      <p className="text-[10px] font-mono text-muted">
                        {p.ativo_tv ? 'na TV · ' : ''}{new Date(p.atualizado_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                    {podeEditar && (
                      <div className="flex items-center gap-1 shrink-0">
                        {!p.ativo_tv && (
                          <button onClick={() => ativar(p)} title="Mostrar na TV" className="text-[10px] font-mono uppercase tracking-wide text-online/90 border border-online/30 rounded px-1.5 py-1 hover:bg-online/10">TV</button>
                        )}
                        {confirmando?.id === p.id && confirmando.acao === 'carregar' ? (
                          <button onClick={() => carregar(p)} title="Confirmar: substitui o board ao vivo" className="text-[10px] font-mono uppercase text-warn border border-warn/40 rounded px-1.5 py-1 hover:bg-warn/10">confirmar?</button>
                        ) : (
                          <button onClick={() => setConfirmando({ id: p.id, acao: 'carregar' })} title="Carregar no editor (substitui o board ao vivo)" className="text-slate-300 hover:text-signal-400 border border-white/10 rounded px-1.5 py-1" aria-label="Carregar no editor">
                            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5" /><path d="M12 15V3" /></svg>
                          </button>
                        )}
                        <button onClick={() => setRenomeando({ id: p.id, nome: p.nome })} title="Renomear" className="text-slate-300 hover:text-slate-100 border border-white/10 rounded px-1.5 py-1" aria-label="Renomear">
                          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
                        </button>
                        {confirmando?.id === p.id && confirmando.acao === 'excluir' ? (
                          <button onClick={() => excluir(p)} className="text-[10px] font-mono uppercase text-offline border border-offline/40 rounded px-1.5 py-1 hover:bg-offline/10">excluir?</button>
                        ) : (
                          <button onClick={() => setConfirmando({ id: p.id, acao: 'excluir' })} title="Excluir preset" className="text-slate-300 hover:text-offline border border-white/10 rounded px-1.5 py-1" aria-label="Excluir">
                            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          <p className="text-[10px] font-mono text-muted mt-2.5 leading-snug border-t border-white/5 pt-2">
            A TV mostra o preset ativo (●). Editar o board não muda a TV até salvar/ativar um preset.
          </p>
        </div>
      )}
    </div>
  );
}
