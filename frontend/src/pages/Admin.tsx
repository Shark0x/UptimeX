import { useEffect, useState } from 'react';
import { api, ConfigResumo, Papel, UsuarioListado } from '../api';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast';
import { AcessosLog } from '../components/AcessosLog';

const DIAS_SEMANA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const RESUMO_PADRAO: ConfigResumo = {
  diarioAtivo: true,
  diarioHora: 8,
  semanalAtivo: true,
  semanalDia: 1,
  semanalHora: 8,
};

type AbaAdmin = 'sistema' | 'usuarios' | 'alertas' | 'integracao' | 'acessos';

interface Overview {
  empresas: number;
  usuarios: number;
  links_dedicados: number;
  dispositivos: { total: number; online: number; degradados: number; offline: number };
  servicos: { banco: boolean; telegram: boolean; mcp: boolean };
  uptime_segundos: number;
}

function formatarUptime(seg: number): string {
  const d = Math.floor(seg / 86400);
  const h = Math.floor((seg % 86400) / 3600);
  const m = Math.floor((seg % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}min`;
  return `${m}min`;
}

function Kpi({ rotulo, valor, tom }: { rotulo: string; valor: string | number; tom?: 'online' | 'offline' | 'warn' }) {
  const cor =
    tom === 'online' ? 'text-online' : tom === 'offline' ? 'text-offline' : tom === 'warn' ? 'text-warn' : 'text-slate-100';
  return (
    <div className="glass-panel px-4 py-3.5">
      <p className={`stat-number text-2xl leading-none ${cor}`}>{valor}</p>
      <p className="text-[10px] uppercase tracking-widest text-muted font-mono mt-1.5">{rotulo}</p>
    </div>
  );
}

function LinhaServico({ nome, ok, detalhe }: { nome: string; ok: boolean; detalhe: string }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-white/[0.05] last:border-0">
      <div className="flex items-center gap-2.5">
        <span className={`relative flex w-2.5 h-2.5`}>
          {ok && <span className="absolute inline-flex h-full w-full rounded-full bg-online/40 animate-sonar" />}
          <span className={`relative inline-flex rounded-full w-2.5 h-2.5 ${ok ? 'status-dot-online' : 'bg-muted'}`} />
        </span>
        <span className="text-sm text-slate-200">{nome}</span>
      </div>
      <span className={`text-xs font-mono ${ok ? 'text-online' : 'text-muted'}`}>{detalhe}</span>
    </div>
  );
}

export function Admin() {
  const { usuario, isAdmin } = useAuth();
  const toast = useToast();
  const [aba, setAba] = useState<AbaAdmin>('sistema');

  const [overview, setOverview] = useState<Overview | null>(null);

  const [usuarios, setUsuarios] = useState<UsuarioListado[]>([]);
  const [formAberto, setFormAberto] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Papel>('visualizador');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  // Alertas do Telegram
  const [telegramAtivo, setTelegramAtivo] = useState<boolean | null>(null);
  const [tokenDefinido, setTokenDefinido] = useState(false);
  const [botToken, setBotToken] = useState('');
  const [chatId, setChatId] = useState('');
  const [atrasoSeg, setAtrasoSeg] = useState(120);
  const [salvandoConfig, setSalvandoConfig] = useState(false);
  const [testandoTelegram, setTestandoTelegram] = useState(false);

  // Resumos periódicos no Telegram
  const [resumo, setResumo] = useState<ConfigResumo>(RESUMO_PADRAO);
  const [salvandoResumo, setSalvandoResumo] = useState(false);
  const [enviandoResumo, setEnviandoResumo] = useState<'diario' | 'semanal' | null>(null);

  // Integração MCP
  const [mcpAtivo, setMcpAtivo] = useState<boolean | null>(null);
  const [mcpCaminho, setMcpCaminho] = useState('/api/mcp');
  const [chaveMcp, setChaveMcp] = useState<string | null>(null);
  const [gerandoChave, setGerandoChave] = useState(false);

  function carregarOverview() {
    if (isAdmin) api.adminOverview().then(setOverview).catch(() => setOverview(null));
  }
  async function carregarUsuarios() {
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
        if (s.resumo) setResumo(s.resumo);
      })
      .catch(() => setTelegramAtivo(null));
  }
  function carregarStatusIntegracao() {
    api
      .statusIntegracao()
      .then((s) => {
        setMcpAtivo(s.mcpAtivo);
        setMcpCaminho(s.caminho);
      })
      .catch(() => setMcpAtivo(null));
  }

  useEffect(() => {
    carregarOverview();
    carregarUsuarios();
    carregarStatusAlertas();
    carregarStatusIntegracao();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function gerarChave() {
    setGerandoChave(true);
    try {
      const { chave } = await api.gerarChaveMcp();
      setChaveMcp(chave);
      toast.sucesso('Chave gerada — copie agora, ela não será mostrada de novo');
      carregarStatusIntegracao();
      carregarOverview();
    } catch (e: any) {
      toast.erro(e.message || 'Não foi possível gerar a chave.');
    } finally {
      setGerandoChave(false);
    }
  }

  async function revogarChave() {
    try {
      await api.revogarChaveMcp();
      setChaveMcp(null);
      toast.sucesso('Chave revogada — a IA não consegue mais conectar');
      carregarStatusIntegracao();
      carregarOverview();
    } catch {
      toast.erro('Não foi possível revogar a chave.');
    }
  }

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
      carregarOverview();
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

  async function salvarResumo() {
    setSalvandoResumo(true);
    try {
      const { resumo: salvo } = await api.salvarConfigResumo(resumo);
      setResumo(salvo);
      toast.sucesso('Resumos periódicos salvos');
    } catch (e: any) {
      toast.erro(e.message || 'Não foi possível salvar os resumos.');
    } finally {
      setSalvandoResumo(false);
    }
  }

  async function enviarResumoAgora(periodo: 'diario' | 'semanal') {
    setEnviandoResumo(periodo);
    try {
      await api.enviarResumoAgora(periodo);
      toast.sucesso(`Resumo ${periodo === 'diario' ? 'diário' : 'semanal'} enviado — confira o Telegram`);
    } catch (e: any) {
      toast.erro(e.message || 'Falha ao enviar o resumo.');
    } finally {
      setEnviandoResumo(null);
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
      carregarUsuarios();
      carregarOverview();
    } catch (e: any) {
      setErro(e.message || 'Não foi possível criar o usuário.');
    } finally {
      setSalvando(false);
    }
  }

  async function removerUsuario(id: number, nome: string) {
    try {
      await api.removerUsuario(id);
      toast.sucesso(`Usuário "${nome}" removido`);
    } catch (e: any) {
      toast.erro(e.message || 'Não foi possível remover o usuário.');
    }
    carregarUsuarios();
    carregarOverview();
  }

  const abas: { id: AbaAdmin; label: string }[] = [
    { id: 'sistema', label: 'Sistema' },
    { id: 'usuarios', label: 'Usuários' },
    { id: 'alertas', label: 'Alertas' },
    { id: 'integracao', label: 'Integração IA' },
    { id: 'acessos', label: 'Acessos' },
  ];

  return (
    <div className="h-full overflow-y-auto pb-6">
      <header className="mb-5">
        <p className="eyebrow mb-1">Painel de administração</p>
        <h1 className="font-display text-2xl font-semibold text-slate-100 tracking-tight">Administração</h1>
      </header>

      <nav className="flex gap-1 mb-5 border-b border-white/[0.07] overflow-x-auto">
        {abas.map((a) => (
          <button
            key={a.id}
            onClick={() => setAba(a.id)}
            className={`px-4 py-2 text-sm font-display border-b-2 whitespace-nowrap transition-all duration-150 ${
              aba === a.id ? 'border-signal-500 text-signal-400' : 'border-transparent text-muted hover:text-slate-300'
            }`}
          >
            {a.label}
          </button>
        ))}
      </nav>

      {/* ================= SISTEMA ================= */}
      {aba === 'sistema' && (
        <div className="animate-fade-up space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Kpi rotulo="empresas" valor={overview?.empresas ?? '—'} />
            <Kpi rotulo="dispositivos" valor={overview?.dispositivos.total ?? '—'} />
            <Kpi
              rotulo="no ar"
              valor={overview ? overview.dispositivos.online + overview.dispositivos.degradados : '—'}
              tom="online"
            />
            <Kpi
              rotulo="fora do ar"
              valor={overview?.dispositivos.offline ?? '—'}
              tom={overview && overview.dispositivos.offline > 0 ? 'offline' : undefined}
            />
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <div className="glass-panel hud-corners p-5">
              <p className="eyebrow mb-3">Serviços</p>
              <LinhaServico nome="Banco de dados" ok={overview?.servicos.banco ?? false} detalhe={overview?.servicos.banco ? 'operando' : 'sem resposta'} />
              <LinhaServico
                nome="Motor de monitoramento"
                ok={(overview?.dispositivos.total ?? 0) >= 0}
                detalhe={`${overview?.dispositivos.total ?? 0} dispositivos`}
              />
              <LinhaServico
                nome="Alertas no Telegram"
                ok={overview?.servicos.telegram ?? false}
                detalhe={overview?.servicos.telegram ? 'ativo' : 'não configurado'}
              />
              <LinhaServico
                nome="Integração IA (MCP)"
                ok={overview?.servicos.mcp ?? false}
                detalhe={overview?.servicos.mcp ? 'ativo' : 'desligado'}
              />
            </div>

            <div className="glass-panel hud-corners p-5">
              <p className="eyebrow mb-3">Números</p>
              <div className="space-y-3 font-mono text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted">Usuários ativos</span>
                  <span className="text-slate-100 tabular-nums">{overview?.usuarios ?? '—'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted">Blocos de IP dedicados</span>
                  <span className="text-slate-100 tabular-nums">{overview?.links_dedicados ?? '—'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted">Empresas degradadas</span>
                  <span className={`tabular-nums ${overview && overview.dispositivos.degradados > 0 ? 'text-warn' : 'text-slate-100'}`}>
                    {overview?.dispositivos.degradados ?? '—'}
                  </span>
                </div>
                <div className="flex items-center justify-between border-t border-white/[0.06] pt-3">
                  <span className="text-muted">Backend no ar há</span>
                  <span className="text-slate-100 tabular-nums">
                    {overview ? formatarUptime(overview.uptime_segundos) : '—'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================= USUÁRIOS ================= */}
      {aba === 'usuarios' && (
        <div className="animate-fade-up">
          <div className="flex items-center justify-between mb-3">
            <p className="text-muted text-sm font-mono">contas de acesso — admin e visualizador</p>
            {isAdmin && (
              <button onClick={() => setFormAberto(true)} className="btn-primary">
                + Novo usuário
              </button>
            )}
          </div>

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
                      {isAdmin && u.id !== usuario?.id && u.ativo && (
                        <button onClick={() => removerUsuario(u.id, u.username)} className="text-xs text-offline hover:underline">
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
        </div>
      )}

      {/* ================= ALERTAS ================= */}
      {aba === 'alertas' && (
        <div className="space-y-4 animate-fade-up">
        <div className="glass-panel hud-corners p-5">
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
              <div className="sm:col-span-2 flex flex-wrap items-center justify-between gap-3">
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

        {/* --- Resumos periódicos --- */}
        <div className="glass-panel hud-corners p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="eyebrow mb-1">Resumo periódico</p>
              <p className="font-display font-semibold text-slate-100">Envios automáticos no Telegram</p>
              <p className="text-muted text-sm mt-1 max-w-lg">
                Um apanhado de quantas quedas houve, tempo total fora do ar e quem mais caiu — enviado no horário escolhido.
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={() => enviarResumoAgora('diario')}
                disabled={!telegramAtivo || enviandoResumo !== null}
                className="btn-ghost border border-white/10 disabled:opacity-40"
              >
                {enviandoResumo === 'diario' ? 'Enviando…' : 'Testar diário'}
              </button>
              <button
                onClick={() => enviarResumoAgora('semanal')}
                disabled={!telegramAtivo || enviandoResumo !== null}
                className="btn-ghost border border-white/10 disabled:opacity-40"
              >
                {enviandoResumo === 'semanal' ? 'Enviando…' : 'Testar semanal'}
              </button>
            </div>
          </div>

          {isAdmin && (
            <div className="mt-4 pt-4 border-t border-white/[0.06] space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-slate-200 cursor-pointer select-none min-w-[140px]">
                  <input
                    type="checkbox"
                    checked={resumo.diarioAtivo}
                    onChange={(e) => setResumo({ ...resumo, diarioAtivo: e.target.checked })}
                    className="accent-signal-500 w-4 h-4"
                  />
                  Resumo diário
                </label>
                <div className="flex items-center gap-2 text-sm text-muted">
                  às
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={resumo.diarioHora}
                    onChange={(e) => setResumo({ ...resumo, diarioHora: Number(e.target.value) })}
                    disabled={!resumo.diarioAtivo}
                    className="input w-20 disabled:opacity-40"
                  />
                  h
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-slate-200 cursor-pointer select-none min-w-[140px]">
                  <input
                    type="checkbox"
                    checked={resumo.semanalAtivo}
                    onChange={(e) => setResumo({ ...resumo, semanalAtivo: e.target.checked })}
                    className="accent-signal-500 w-4 h-4"
                  />
                  Resumo semanal
                </label>
                <div className="flex items-center gap-2 text-sm text-muted">
                  toda
                  <select
                    value={resumo.semanalDia}
                    onChange={(e) => setResumo({ ...resumo, semanalDia: Number(e.target.value) })}
                    disabled={!resumo.semanalAtivo}
                    className="input w-32 disabled:opacity-40"
                  >
                    {DIAS_SEMANA.map((d, i) => (
                      <option key={i} value={i}>{d}</option>
                    ))}
                  </select>
                  às
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={resumo.semanalHora}
                    onChange={(e) => setResumo({ ...resumo, semanalHora: Number(e.target.value) })}
                    disabled={!resumo.semanalAtivo}
                    className="input w-20 disabled:opacity-40"
                  />
                  h
                </div>
              </div>

              <div className="flex justify-end">
                <button onClick={salvarResumo} disabled={salvandoResumo} className="btn-primary">
                  {salvandoResumo ? 'Salvando…' : 'Salvar resumos'}
                </button>
              </div>
            </div>
          )}
        </div>
        </div>
      )}

      {/* ================= INTEGRAÇÃO IA (MCP) ================= */}
      {aba === 'integracao' && (
        <div className="glass-panel hud-corners p-5 animate-fade-up">
          {!isAdmin ? (
            <p className="text-muted text-sm">Somente administradores podem gerenciar a integração.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="eyebrow mb-1">Integração IA</p>
                  <p className="font-display font-semibold text-slate-100">
                    Servidor MCP{' '}
                    <span className={`text-xs font-mono uppercase tracking-wider ml-2 ${mcpAtivo ? 'text-online' : 'text-muted'}`}>
                      {mcpAtivo === null ? '' : mcpAtivo ? '● ativo' : '○ desligado'}
                    </span>
                  </p>
                  <p className="text-muted text-sm mt-1 max-w-xl">
                    Permite que a IA da empresa (Claude ou compatível com MCP) consulte o monitoramento — status das
                    empresas, quedas, latência. Somente leitura, protegido por chave.
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  {mcpAtivo && (
                    <button onClick={revogarChave} className="btn-ghost border border-white/10 text-offline/80 hover:text-offline">
                      Revogar
                    </button>
                  )}
                  <button onClick={gerarChave} disabled={gerandoChave} className="btn-primary">
                    {gerandoChave ? 'Gerando…' : mcpAtivo ? 'Gerar nova chave' : 'Ativar e gerar chave'}
                  </button>
                </div>
              </div>

              {chaveMcp && (
                <div className="mt-4 pt-4 border-t border-white/[0.06]">
                  <p className="text-[11px] font-mono uppercase tracking-widest text-warn mb-1.5">
                    Copie agora — esta chave não será mostrada de novo
                  </p>
                  <code className="block bg-deep-950/70 border border-signal-500/30 rounded-lg px-3 py-2 font-mono text-sm text-signal-400 break-all select-all">
                    {chaveMcp}
                  </code>
                </div>
              )}

              {mcpAtivo && (
                <div className="mt-4 pt-4 border-t border-white/[0.06] text-[11px] font-mono text-muted space-y-1">
                  <p className="text-slate-300 uppercase tracking-widest text-[10px] mb-1.5">Como conectar a IA</p>
                  <p>
                    Endpoint MCP (HTTP): <span className="text-slate-200">http://IP_DA_MAQUINA:8080{mcpCaminho}</span>
                  </p>
                  <p>
                    Autenticação: header <span className="text-slate-200">Authorization: Bearer &lt;chave&gt;</span>
                  </p>
                  <p className="text-muted/80">
                    Ferramentas: status_geral · listar_empresas · buscar_empresa · dispositivos_empresa · quedas_recentes
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ================= ACESSOS ================= */}
      {aba === 'acessos' && (
        <div className="animate-fade-up">
          <p className="text-muted text-sm font-mono mb-3">
            login e tentativas de login no site — usuário, IP e localização
          </p>
          <AcessosLog />
        </div>
      )}

      {formAberto && (
        <div className="fixed inset-0 bg-deep-950/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
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
