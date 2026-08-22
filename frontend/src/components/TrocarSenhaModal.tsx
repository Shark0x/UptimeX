import { useState } from 'react';
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

  async function salvar() {
    if (nova !== confirmacao) return setErro('A confirmacao nao corresponde a nova senha.');
    if (nova.length < 12 || !/[a-z]/.test(nova) || !/[A-Z]/.test(nova) || !/[0-9]/.test(nova)) {
      return setErro('Use ao menos 12 caracteres, com maiuscula, minuscula e numero.');
    }
    setSalvando(true);
    setErro('');
    try {
      await api.alterarMinhaSenha(atual, nova);
      toast.sucesso('Senha alterada e outras sessoes revogadas.');
      onClose();
    } catch (e: any) {
      setErro(e.message || 'Nao foi possivel alterar a senha.');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[80] bg-deep-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="glass-panel p-6 w-full max-w-sm">
        <p className="eyebrow mb-1">Seguranca da conta</p>
        <h2 className="font-display font-semibold text-lg text-slate-100 mb-4">Alterar senha</h2>
        <div className="space-y-3">
          <label className="block"><span className="label-field">Senha atual</span><PasswordInput value={atual} onChange={(e) => setAtual(e.target.value)} className="input" autoComplete="current-password" /></label>
          <label className="block"><span className="label-field">Nova senha</span><PasswordInput value={nova} onChange={(e) => setNova(e.target.value)} className="input" autoComplete="new-password" maxLength={200} /></label>
          <label className="block"><span className="label-field">Confirmar nova senha</span><PasswordInput value={confirmacao} onChange={(e) => setConfirmacao(e.target.value)} className="input" autoComplete="new-password" maxLength={200} /></label>
        </div>
        {erro && <p className="text-offline text-xs mt-3">{erro}</p>}
        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="btn-ghost">Cancelar</button>
          <button onClick={salvar} disabled={salvando || !atual || !nova} className="btn-primary">{salvando ? 'Salvando...' : 'Alterar senha'}</button>
        </div>
      </div>
    </div>
  );
}
