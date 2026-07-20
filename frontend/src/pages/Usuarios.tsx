import { useEffect, useState } from 'react';
import { api, Papel, UsuarioListado } from '../api';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast';

export function Usuarios() {
  const { usuario } = useAuth();
  const toast = useToast();
  const [usuarios, setUsuarios] = useState<UsuarioListado[]>([]);
  const [formAberto, setFormAberto] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Papel>('visualizador');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [telegramAtivo, setTelegramAtivo] = useState<boolean | null>(null);
  const [testandoTelegram, setTestandoTelegram] = useState(false);

  async function carregar() {
    setUsuarios(await api.listarUsuarios());
  }

  useEffect(() => {
    carregar();
    api.statusAlertas().then((s) => setTelegramAtivo(s.telegramConfigurado)).catch(() => setTelegramAtivo(null));
  }, []);

  async function testarTelegram() {
    setTestandoTelegram(true);
    try {
      await api.testarAlertaTelegram();
      toast.sucesso('Mensagem de teste enviada — confira o Telegram');
    } catch (e: any) {
      toast.erro(e.message || 'Falha ao testar o Telegram.');
    } finally {
      setTestandoTelegram(false);
    }
  }

  function fecharForm() {
    setFormAberto(false);
    setUsername('');
    setPassword('');
    setRole('visualizador');
    setErro('');
  }

  async function criar() {
    if (!username.trim() || password.length < 6) {
      setErro('Usuário obrigatório e senha com pelo menos 6 caracteres.');
      return;
    }
    setSalvando(true);
    setErro('');
    try {
      await api.criarUsuario(username.trim(), password, role);
      toast.sucesso(`Usuário "${username.trim()}" criado`);
      fecharForm();
      carregar();
    } catch (e: any) {
      setErro(e.message || 'Não foi possível criar o usuário.');
    } finally {
      setSalvando(false);
    }
  }

  async function remover(id: number, nome: string) {
    try {
      await api.removerUsuario(id);
      toast.sucesso(`Usuário "${nome}" removido`);
    } catch (e: any) {
      toast.erro(e.message || 'Não foi possível remover o usuário.');
    }
    carregar();
  }

  return (
    <div>
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl font-semibold text-slate-100 tracking-tight">Usuários</h1>
          <p className="text-muted text-sm font-mono mt-1">contas de acesso — admin e visualizador</p>
        </div>
        <button onClick={() => setFormAberto(true)} className="btn-primary">
          + Novo usuário
        </button>
      </header>

      <div className="glass-panel overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-widest text-muted font-mono border-b border-white/10">
              <th className="px-4 py-3 font-normal">Usuário</th>
              <th className="px-4 py-3 font-normal">Papel</th>
              <th className="px-4 py-3 font-normal">Status</th>
              <th className="px-4 py-3 font-normal"></th>
            </tr>
          </thead>
          <tbody>
            {usuarios.map((u) => (
              <tr key={u.id} className="border-b border-white/5 last:border-0">
                <td className="px-4 py-3 text-slate-200">{u.username}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs font-mono uppercase ${u.role === 'admin' ? 'text-signal-400' : 'text-muted'}`}>{u.role}</span>
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs font-mono ${u.ativo ? 'text-online' : 'text-offline'}`}>{u.ativo ? 'ativo' : 'inativo'}</span>
                </td>
                <td className="px-4 py-3 text-right">
                  {u.id !== usuario?.id && u.ativo && (
                    <button onClick={() => remover(u.id, u.username)} className="text-xs text-offline hover:underline">
                      Remover
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {usuarios.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-6 text-center text-muted text-sm">Nenhum usuário cadastrado.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* -------- alertas externos -------- */}
      <div className="glass-panel hud-corners p-5 mt-4 flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="eyebrow mb-1">Alertas</p>
          <p className="font-display font-semibold text-slate-100">
            Telegram{' '}
            <span className={`text-xs font-mono uppercase tracking-wider ml-2 ${telegramAtivo ? 'text-online' : 'text-muted'}`}>
              {telegramAtivo === null ? '' : telegramAtivo ? '● ativo' : '○ não configurado'}
            </span>
          </p>
          <p className="text-muted text-sm mt-1 max-w-lg">
            {telegramAtivo
              ? 'Quedas com mais de 2 minutos e recuperações chegam no chat configurado.'
              : 'Defina TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID no backend/.env (passo a passo no .env.example) e reinicie o backend.'}
          </p>
        </div>
        <button onClick={testarTelegram} disabled={testandoTelegram} className="btn-ghost border border-white/10 disabled:opacity-50">
          {testandoTelegram ? 'Enviando…' : 'Enviar teste'}
        </button>
      </div>

      {formAberto && (
        <div className="fixed inset-0 bg-deep-950/80 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="glass-panel p-6 w-full max-w-sm">
            <h2 className="font-display font-semibold text-lg text-slate-100 mb-4">Novo usuário</h2>
            <div className="space-y-3">
              <div>
                <label className="label-field">Usuário</label>
                <input value={username} onChange={(e) => setUsername(e.target.value)} className="input" maxLength={50} autoComplete="off" />
              </div>
              <div>
                <label className="label-field">Senha</label>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="input" maxLength={200} autoComplete="new-password" />
              </div>
              <div>
                <label className="label-field">Papel</label>
                <select value={role} onChange={(e) => setRole(e.target.value as Papel)} className="input">
                  <option value="visualizador">Visualizador (somente leitura)</option>
                  <option value="admin">Administrador</option>
                </select>
              </div>
            </div>

            {erro && <p className="text-offline text-xs mt-3">{erro}</p>}

            <div className="flex justify-end gap-2 mt-6">
              <button onClick={fecharForm} className="btn-ghost">Cancelar</button>
              <button onClick={criar} disabled={salvando} className="btn-primary">
                {salvando ? 'Salvando...' : 'Criar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
