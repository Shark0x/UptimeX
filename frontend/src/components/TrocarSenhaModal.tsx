import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';
import { useToast } from './Toast';
import { PasswordInput } from './PasswordInput';

export function TrocarSenhaModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    function aoTecla(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', aoTecla);
    return () => document.removeEventListener('keydown', aoTecla);
  }, [onClose]);

  async function salvar() {
    if (nova !== confirmacao) return setErro('A confirmação não corresponde à nova senha.');
    if (nova.length < 12 || !/[a-z]/.test(nova) || !/[A-Z]/.test(nova) || !/[0-9]/.test(nova)) {
      return setErro('Use ao menos 12 caracteres, com maiúscula, minúscula e número.');
    }
    setSalvando(true);
    setErro('');
    try {
      await api.alterarMinhaSenha(atual, nova);
      toast.sucesso('Senha alterada e outras sessões revogadas.');
      onClose();
    } catch (e: any) {
      setErro(e.message || 'Não foi possível alterar a senha.');
    } finally {
      setSalvando(false);
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[80] bg-deep-950/80 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Alterar senha"
    >
      <div className="modal-panel w-full max-w-sm overflow-hidden animate-fade-up" onClick={(e) => e.stopPropagation()}>
        {/* Cabeçalho */}
        <div className="relative px-6 pt-6 pb-5 border-b border-white/[0.08] overflow-hidden">
          <div aria-hidden className="absolute -top-16 -right-12 w-44 h-44 rounded-full bg-signal-600/15 blur-3xl" />
          <div className="relative flex items-start gap-3.5">
            <span className="shrink-0 w-11 h-11 rounded-xl bg-gradient-to-br from-signal-600 to-accent-600 shadow-glow-signal flex items-center justify-center">
              <svg className="w-5 h-5 text-[#fff]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </span>
            <div className="min-w-0 flex-1">
              <p className="eyebrow mb-1">Segurança da conta</p>
              <h2 className="font-display font-semibold text-xl text-slate-50 leading-tight">Alterar senha</h2>
              <p className="text-xs text-slate-300/80 mt-1.5 leading-relaxed">Ao confirmar, suas outras sessões serão encerradas.</p>
            </div>
            <button
              onClick={onClose}
              aria-label="Fechar"
              className="shrink-0 -mt-1 -mr-1 w-8 h-8 rounded-lg flex items-center justify-center text-muted hover:text-slate-100 hover:bg-white/[0.06] transition-colors"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Corpo */}
        <div className="px-6 py-5 space-y-3">
          <label className="block">
            <span className="label-field">Senha atual</span>
            <PasswordInput value={atual} onChange={(e) => setAtual(e.target.value)} className="input" autoComplete="current-password" />
          </label>
          <label className="block">
            <span className="label-field">Nova senha</span>
            <PasswordInput value={nova} onChange={(e) => setNova(e.target.value)} className="input" autoComplete="new-password" maxLength={200} />
          </label>
          <label className="block">
            <span className="label-field">Confirmar nova senha</span>
            <PasswordInput value={confirmacao} onChange={(e) => setConfirmacao(e.target.value)} className="input" autoComplete="new-password" maxLength={200} />
          </label>
          <p className="text-[11px] text-muted leading-relaxed flex items-start gap-1.5">
            <svg className="w-3.5 h-3.5 shrink-0 mt-px text-muted/70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4M12 8h.01" />
            </svg>
            Mínimo de 12 caracteres, com maiúscula, minúscula e número.
          </p>
          {erro && <p className="text-offline text-xs">{erro}</p>}
        </div>

        {/* Rodapé */}
        <div className="px-6 py-4 border-t border-white/[0.08] flex justify-end gap-2">
          <button onClick={onClose} className="btn-ghost">Cancelar</button>
          <button onClick={salvar} disabled={salvando || !atual || !nova} className="btn-primary">
            {salvando ? 'Salvando…' : 'Alterar senha'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
