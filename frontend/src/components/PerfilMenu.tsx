import { useEffect, useRef, useState } from 'react';
import { api, buscarMeuAvatar } from '../api';
import { useAuth } from '../auth/AuthContext';
import { APP_VERSION_ROTULO } from '../version';
import { TrocarSenhaModal } from './TrocarSenhaModal';
import { useToast } from './Toast';

const TIPOS_ACEITOS = ['image/jpeg', 'image/png', 'image/webp'];

/** Avatar do usuário logado (busca o blob autenticado); cai nas iniciais se não houver. */
function Avatar({ nome, versao, tamanho }: { nome: string; versao: string | null | undefined; tamanho: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelado = false;
    let objectUrl: string | null = null;
    if (!versao) {
      setSrc(null);
      return;
    }
    buscarMeuAvatar()
      .then((blob) => {
        if (!blob || cancelado) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => !cancelado && setSrc(null));
    return () => {
      cancelado = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [versao]);

  const style = { width: tamanho, height: tamanho };
  if (src) {
    return <img src={src} alt="" style={style} className="rounded-full object-cover border border-white/15" />;
  }
  return (
    <div
      style={style}
      className="rounded-full bg-gradient-to-br from-signal-600 to-accent-600 flex items-center justify-center font-display font-semibold text-white"
    >
      <span style={{ fontSize: tamanho * 0.4 }}>{nome.slice(0, 2).toUpperCase()}</span>
    </div>
  );
}

export function PerfilMenu({ onLogout }: { onLogout: () => void }) {
  const { usuario, atualizarAvatar } = useAuth();
  const [aberto, setAberto] = useState(false);
  const [senhaAberta, setSenhaAberta] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  useEffect(() => {
    if (!aberto) return;
    function aoClicarFora(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setAberto(false);
    }
    document.addEventListener('pointerdown', aoClicarFora);
    return () => document.removeEventListener('pointerdown', aoClicarFora);
  }, [aberto]);

  if (!usuario) return null;

  async function aoEscolherArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    e.target.value = ''; // permite re-selecionar o mesmo arquivo
    if (!arquivo) return;
    if (!TIPOS_ACEITOS.includes(arquivo.type)) {
      toast.erro('Use uma imagem JPEG, PNG ou WebP.');
      return;
    }
    if (arquivo.size > 4 * 1024 * 1024) {
      toast.erro('Imagem muito grande (máx. 4MB).');
      return;
    }
    setEnviando(true);
    try {
      const { avatar_url } = await api.enviarAvatar(arquivo);
      atualizarAvatar(avatar_url);
      toast.sucesso('Avatar atualizado');
    } catch (err: any) {
      toast.erro(err.message || 'Não foi possível enviar o avatar.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setAberto((v) => !v)}
        className="flex items-center gap-2.5 group"
        aria-haspopup="menu"
        aria-expanded={aberto}
        title="Meu perfil"
      >
        <Avatar nome={usuario.username} versao={usuario.avatar_url} tamanho={34} />
        <div className="text-right hidden sm:block leading-tight">
          <p className="text-sm text-slate-200 group-hover:text-white transition-colors">{usuario.username}</p>
          <p className="text-[10px] uppercase tracking-widest text-muted font-mono">{usuario.role}</p>
        </div>
      </button>

      {aberto && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-2 w-64 z-[60] glass-panel border-white/15 shadow-2xl overflow-hidden animate-fade-up"
        >
          <div className="flex items-center gap-3 px-4 py-3.5 border-b border-white/[0.08] bg-deep-900/40">
            <Avatar nome={usuario.username} versao={usuario.avatar_url} tamanho={44} />
            <div className="min-w-0">
              <p className="text-sm font-display font-semibold text-slate-100 truncate">{usuario.username}</p>
              <p className="text-[10px] uppercase tracking-widest text-muted font-mono">{usuario.role}</p>
            </div>
          </div>

          <div className="p-1.5">
            <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={aoEscolherArquivo} />
            <button
              onClick={() => inputRef.current?.click()}
              disabled={enviando}
              className="w-full text-left px-3 py-2 rounded-lg text-sm text-slate-200 hover:bg-white/[0.06] transition-colors flex items-center gap-2.5 disabled:opacity-50"
            >
              <svg className="w-4 h-4 text-muted shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M17 8l-5-5-5 5" /><path d="M12 3v12" />
              </svg>
              {enviando ? 'Enviando…' : 'Trocar avatar'}
            </button>
            <button
              onClick={() => { setAberto(false); setSenhaAberta(true); }}
              className="w-full text-left px-3 py-2 rounded-lg text-sm text-slate-200 hover:bg-white/[0.06] transition-colors flex items-center gap-2.5"
            >
              <svg className="w-4 h-4 text-muted shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              Alterar senha
            </button>
            <button
              onClick={() => { setAberto(false); onLogout(); }}
              className="w-full text-left px-3 py-2 rounded-lg text-sm text-offline hover:bg-signal-600/10 transition-colors flex items-center gap-2.5"
            >
              <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" />
              </svg>
              Sair
            </button>
          </div>

          <div className="px-4 py-2 border-t border-white/[0.08] text-[10px] font-mono text-muted/70 text-center">
            {APP_VERSION_ROTULO}
          </div>
        </div>
      )}

      {senhaAberta && <TrocarSenhaModal onClose={() => setSenhaAberta(false)} />}
    </div>
  );
}
