import { useEffect, useState } from 'react';
import { api, Papel, UsuarioListado } from '../api';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast';

export function Usuarios() {
  const { usuario, isAdmin } = useAuth();
  const toast = useToast();
  const [usuarios, setUsuarios] = useState<UsuarioListado[]>([]);
  const [formAberto, setFormAberto] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Papel>('visualizador');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  // Configuração dos alertas do Telegram
  const [telegramAtivo, setTelegramAtivo] = useState<boolean | null>(null);
  const [tokenDefinido, setTokenDefinido] = useState(false);
  const [botToken, setBotToken] = useState('');
  const [chatId, setChatId] = useState('');
  const [atrasoSeg, setAtrasoSeg] = useState(120);
  const [salvandoConfig, setSalvandoConfig] = useState(false);
  const [testandoTelegram, setTestandoTelegram] = useState(false);

  async function carregar() {
    setUsuarios(await api.listarUsuarios());
  }

  function carregarStatusAlertas() {
    api
      .statusAlertas()
      .then((s) => {
        setTelegramAtivo(s.telegramConfigurado);
        setTokenDefinido(s.tokenDefinido);
        setChatId(s.chatId || '');
        setAtrasoSeg(s.atrasoSeg || 120);
      })
      .catch(() => setTelegramAtivo(null));
  }

  useEffect(() => {
    carregar();
    carregarStatusAlertas();
  }, []);

  async function salvarConfig() {
    setSalvandoConfig(true);
    try {
      await api.salvarConfigAlertas({
        bot_token: botToken.trim() || undefined,
        chat_id: chatId.trim(),
        alerta_atraso_seg: atrasoSeg,
      });
      setBotToken('');
      toast.sucesso('Configuração salva');
      carregarStatusAlertas();
    } catch (e: any) {
      toast.erro(e.message || 'Não foi possível salvar a configuração.');
    } finally {
      setSalvandoConfig(false);
    }
  }

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

      {/* -------- alertas do Telegram -------- */}
      <div className="glass-panel hud-corners p-5 mt-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="eyebrow mb-1">Alertas</p>
            <p className="font-display font-semibold text-slate-100">
              Telegram{' '}
              <span className={`text-xs font-mono uppercase tracking-wider ml-2 ${telegramAtivo ? 'text-online' : 'text-muted'}`}>
                {telegramAtivo === null ? '' : telegramAtivo ? '● ativo' : '○ não configurado'}
              </span>
            </p>
            <p className="text-muted text-sm mt-1 max-w-lg">
              Quedas que passam do tempo abaixo e as recuperações chegam no chat configurado.
            </p>
          </div>
          <button
            onClick={testarTelegram}
            disabled={testandoTelegram || !telegramAtivo}
            className="btn-ghost border border-white/10 disabled:opacity-40"
          >
            {testandoTelegram ? 'Enviando…' : 'Enviar teste'}
          </button>
        </div>

        {isAdmin && (
          <div className="mt-4 pt-4 border-t border-white/[0.06] grid sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="label-field">Token do bot (@BotFather)</label>
              <input
                type="password"
                value={botToken}
                onChange={(e) => setBotToken(e.target.value)}
                placeholder={tokenDefinido ? '•••••••••• (deixe em branco pra manter)' : 'cole o token aqui'}
                className="input font-mono"
                autoComplete="off"
              />
            </div>
            <div>
              <label className="label-field">Chat ID</label>
              <input
                value={chatId}
                onChange={(e) => setChatId(e.target.value)}
                placeholder="ex: 8123456789 ou -100123... (grupo)"
                className="input font-mono"
                autoComplete="off"
              />
            </div>
            <div>
              <label className="label-field">Alertar queda após (segundos)</label>
              <input
                type="number"
                value={atrasoSeg}
                onChange={(e) => setAtrasoSeg(Number(e.target.value))}
                min={10}
                max={3600}
                className="input"
              />
            </div>
            <div className="sm:col-span-2 flex items-center justify-between gap-3">
              <p className="text-[11px] font-mono text-muted">
                Como pegar o chat id:{' '}
                <span className="text-slate-300">mande um "oi" pro bot → abra api.telegram.org/bot&lt;token&gt;/getUpdates</span>
              </p>
              <button onClick={salvarConfig} disabled={salvandoConfig} className="btn-primary shrink-0">
                {salvandoConfig ? 'Salvando…' : 'Salvar configuração'}
              </button>
            </div>
          </div>
        )}
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
