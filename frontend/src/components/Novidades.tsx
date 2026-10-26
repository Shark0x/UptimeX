import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { CHANGELOG, APP_VERSION, type TipoMudanca } from '../data/changelog';

// Rótulo + cores de cada tipo de mudança. Paleta restrita e semântica (verde=novo,
// azul=melhoria, âmbar=correção, vermelho=segurança) — não um arco-íris genérico.
const TIPOS: Record<TipoMudanca, { rotulo: string; tag: string }> = {
  novo: { rotulo: 'Novo', tag: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/25' },
  melhoria: { rotulo: 'Melhoria', tag: 'text-sky-300 bg-sky-500/10 border-sky-500/25' },
  correcao: { rotulo: 'Correção', tag: 'text-amber-300 bg-amber-500/10 border-amber-500/25' },
  seguranca: { rotulo: 'Segurança', tag: 'text-rose-300 bg-rose-500/10 border-rose-500/25' },
};

function formatarData(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

/**
 * Central de Novidades — release notes do uptimeX em modal sobreposto. Abre
 * automaticamente quando há uma versão nova (ver PerfilMenu) e fica acessível
 * pelo menu de perfil. onClose deve persistir a versão vista (marcarNovidadesVistas).
 */
export function Novidades({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    function aoTecla(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', aoTecla);
    return () => document.removeEventListener('keydown', aoTecla);
  }, [onClose]);

  const ultima = CHANGELOG[0];

  return createPortal(
    <div
      className="fixed inset-0 z-[80] bg-deep-950/80 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Novidades do uptimeX"
    >
      <div
        className="modal-panel w-full max-w-lg max-h-[86vh] flex flex-col overflow-hidden animate-fade-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Hero da versão mais recente */}
        <div className="relative shrink-0 px-6 pt-6 pb-5 border-b border-white/[0.08] overflow-hidden">
          <div aria-hidden className="absolute -top-16 -right-12 w-52 h-52 rounded-full bg-signal-600/20 blur-3xl" />
          <div className="relative flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="eyebrow mb-2">Novidades do uptimeX</p>
              <h2 className="font-display font-semibold text-2xl text-slate-50 leading-tight">{ultima.titulo}</h2>
              {ultima.destaque && (
                <p className="text-sm text-slate-300/90 mt-2 max-w-sm leading-relaxed">{ultima.destaque}</p>
              )}
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
          <div className="relative mt-4 inline-flex items-center gap-2 rounded-full px-3 py-1 bg-gradient-to-br from-signal-600 to-accent-600 shadow-glow-signal">
            <span className="text-[11px] font-mono font-semibold text-[#fff] tracking-wide">v{ultima.versao}</span>
            <span className="w-1 h-1 rounded-full bg-[#fff]/50" />
            <span className="text-[11px] font-mono text-[#fff]/85">{formatarData(ultima.data)}</span>
          </div>
        </div>

        {/* Timeline de versões */}
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-7">
          {CHANGELOG.map((rel, i) => (
            <section key={rel.versao} className="relative pl-6">
              <span aria-hidden className="absolute left-0 top-1.5 w-2.5 h-2.5 rounded-full border-2 border-signal-400 bg-deep-950" />
              {i < CHANGELOG.length - 1 && (
                <span aria-hidden className="absolute left-[4.5px] top-5 -bottom-7 w-px bg-white/10" />
              )}
              <div className="flex items-baseline gap-2.5 flex-wrap">
                <h3 className="font-display font-semibold text-slate-100">
                  <span className="font-mono text-signal-300">v{rel.versao}</span>
                  <span className="text-slate-400 font-normal"> · {rel.titulo}</span>
                </h3>
                <span className="text-[11px] font-mono text-muted">{formatarData(rel.data)}</span>
              </div>
              <ul className="mt-3 space-y-2">
                {rel.mudancas.map((m, j) => (
                  <li key={j} className="flex items-start gap-2.5 text-sm text-slate-300 leading-relaxed">
                    <span
                      className={`shrink-0 mt-0.5 inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wide ${TIPOS[m.tipo].tag}`}
                    >
                      {TIPOS[m.tipo].rotulo}
                    </span>
                    <span className="min-w-0">{m.texto}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        {/* Rodapé */}
        <div className="shrink-0 px-6 py-4 border-t border-white/[0.08] flex items-center justify-between gap-3">
          <span className="text-[11px] font-mono text-muted/70">Você está na versão v{APP_VERSION}</span>
          <button onClick={onClose} className="btn-primary">Entendi</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
