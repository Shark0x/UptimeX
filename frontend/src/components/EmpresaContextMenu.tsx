import { useRef, useState, useEffect } from 'react';
import { Empresa } from '../api';

interface MenuItem {
  label: string;
  icon?: string;
  action: () => void;
  disabled?: boolean;
  isDangerous?: boolean;
}

export function EmpresaContextMenu({
  empresa,
  itens,
  onClose,
}: {
  empresa: Empresa;
  itens: MenuItem[];
  onClose?: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const botaoRef = useRef<HTMLButtonElement>(null);
  const [aberto, setAberto] = useState(false);

  useEffect(() => {
    if (!aberto) return;

    function fecharAoClicarFora(ev: MouseEvent) {
      if (
        menuRef.current &&
        botaoRef.current &&
        !menuRef.current.contains(ev.target as Node) &&
        !botaoRef.current.contains(ev.target as Node)
      ) {
        setAberto(false);
      }
    }

    function fecharAoPressarEscape(ev: KeyboardEvent) {
      if (ev.key === 'Escape') {
        setAberto(false);
      }
    }

    document.addEventListener('mousedown', fecharAoClicarFora);
    document.addEventListener('keydown', fecharAoPressarEscape);

    return () => {
      document.removeEventListener('mousedown', fecharAoClicarFora);
      document.removeEventListener('keydown', fecharAoPressarEscape);
    };
  }, [aberto]);

  function executarAcao(acao: () => void) {
    acao();
    setAberto(false);
    onClose?.();
  }

  return (
    <div className="relative">
      <button
        ref={botaoRef}
        onClick={() => setAberto(!aberto)}
        onKeyDown={(ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault();
            setAberto(!aberto);
          }
        }}
        aria-haspopup="menu"
        aria-expanded={aberto}
        aria-label={`Menu de ações para ${empresa.nome}`}
        className="w-6 h-6 rounded-md flex items-center justify-center text-muted hover:text-slate-100 hover:bg-white/10 transition-colors"
        title="Menu de ações"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="5" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="12" cy="19" r="2" />
        </svg>
      </button>

      {aberto && (
        <div
          ref={menuRef}
          role="menu"
          className="absolute right-0 top-full mt-2 z-[1000] min-w-48 rounded-lg glass-panel border border-white/10 overflow-hidden shadow-xl animate-fade-up"
        >
          {itens.map((item, idx) => (
            <button
              key={idx}
              role="menuitem"
              onClick={() => executarAcao(item.action)}
              disabled={item.disabled}
              className={`w-full text-left px-4 py-2 text-sm font-mono flex items-center gap-2 border-b border-white/5 last:border-b-0 transition-colors
                ${item.disabled
                  ? 'text-muted/50 cursor-not-allowed bg-white/[0.02]'
                  : item.isDangerous
                    ? 'text-offline hover:bg-signal-600/15'
                    : 'text-slate-200 hover:bg-white/[0.08]'
              }`}
            >
              {item.icon && <span className="shrink-0 text-xs">{item.icon}</span>}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
