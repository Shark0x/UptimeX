import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { LockupUptimeX } from '../components/LogoUptimeX';
import { Waves } from '../components/ui/wave-background';

export function TelaLogin() {
  const { login, carregando } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [erro, setErro] = useState('');
  const [tremor, setTremor] = useState(false);

  async function entrar() {
    if (!username.trim() || !password) return;
    setErro('');
    try {
      await login(username.trim(), password);
    } catch (e: any) {
      setErro(
        e?.message === 'SEM_CONEXAO'
          ? 'Sem conexão com o servidor. Confira a rede e se o backend está no ar.'
          : 'Usuário ou senha inválidos.'
      );
      setTremor(true);
      setTimeout(() => setTremor(false), 450);
    }
  }

  return (
    <div className="min-h-screen relative overflow-hidden">
      {/* campo de ondas interativo — reage ao movimento do mouse */}
      <Waves strokeColor="rgba(255, 43, 58, 0.14)" backgroundColor="transparent" />

      {/* vinheta pra manter o texto legível sobre as ondas */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 90% 70% at 30% 40%, transparent 30%, rgba(6,6,7,0.55) 100%), linear-gradient(180deg, transparent 55%, rgba(6,6,7,0.85))',
        }}
      />

      <div className="relative z-10 min-h-screen max-w-6xl mx-auto grid lg:grid-cols-[1.1fr_0.9fr] gap-10 px-6 md:px-12 py-10 items-center">
        {/* ---------------- marca ---------------- */}
        <div className="flex flex-col items-start gap-8">
          <div className="entrada" style={{ animationDelay: '100ms' }}>
            <LockupUptimeX larguraMarca={230} animada />
          </div>
          <p
            className="font-grotesk text-slate-300/90 text-base md:text-lg max-w-md entrada"
            style={{ animationDelay: '240ms' }}
          >
            Cada enlace da sua rede, vigiado em tempo real — ICMP, SNMP, topologia e auditoria numa única central.
          </p>
        </div>

        {/* ---------------- formulário ---------------- */}
        <div className="flex items-center justify-center lg:justify-end">
          <div
            className={`w-full max-w-sm bg-deep-900/90 backdrop-blur-xl border border-white/[0.08] rounded-2xl
              hud-corners p-8 shadow-glass ${tremor ? 'animate-shake' : 'entrada'}`}
            style={tremor ? undefined : { animationDelay: '200ms' }}
          >
            <h2 className="font-grotesk font-semibold text-xl text-slate-100 mb-6">
              Entrar na central
            </h2>

            <div className="space-y-4">
              <div>
                <label className="block font-grotesk text-[13px] text-slate-300 mb-1.5" htmlFor="login-usuario">
                  Usuário
                </label>
                <input
                  id="login-usuario"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  autoFocus
                  maxLength={50}
                  className="input"
                  onKeyDown={(e) => e.key === 'Enter' && entrar()}
                />
              </div>
              <div>
                <label className="block font-grotesk text-[13px] text-slate-300 mb-1.5" htmlFor="login-senha">
                  Senha
                </label>
                <div className="relative">
                  <input
                    id="login-senha"
                    type={mostrarSenha ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    maxLength={200}
                    className="input pr-16"
                    onKeyDown={(e) => e.key === 'Enter' && entrar()}
                  />
                  <button
                    type="button"
                    onClick={() => setMostrarSenha((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 font-grotesk text-xs text-muted hover:text-signal-400 transition-colors px-1"
                    aria-label={mostrarSenha ? 'Ocultar senha' : 'Mostrar senha'}
                  >
                    {mostrarSenha ? 'ocultar' : 'ver'}
                  </button>
                </div>
              </div>
            </div>

            {erro && (
              <p className="text-offline text-sm mt-3 font-grotesk" role="alert">
                {erro}
              </p>
            )}

            <button onClick={entrar} disabled={carregando} className="btn-primary w-full mt-7">
              {carregando ? 'Autenticando…' : 'Acessar a central'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
