import { useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
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
  // Posição FIXA calculada a partir do botão. O menu é renderizado num PORTAL no
  // body pra não ser cortado pelo card/grid (overflow + stacking context criado
  // pelo transform do hover do card prendia o dropdown atrás do card de baixo).
  const [pos, setPos] = useState<{ top?: number; bottom?: number; right: number } | null>(null);

  function abrir() {
    const r = botaoRef.current?.getBoundingClientRect();
    if (r) {
      // Flip pra cima quando não há espaço abaixo (cards no fim da lista).
      const alturaEstimada = Math.min(itens.length * 38 + 8, window.innerHeight * 0.6);
      const abreAcima = r.bottom + alturaEstimada > window.innerHeight - 8 && r.top > alturaEstimada;
      setPos({
        top: abreAcima ? undefined : r.bottom + 6,
        bottom: abreAcima ? window.innerHeight - r.top + 6 : undefined,
        right: Math.max(8, window.innerWidth - r.right),
      });
    }
    setAberto(true);
  }

  function alternar() {
    if (aberto) setAberto(false);
    else abrir();
  }

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
      if (ev.key === 'Escape') setAberto(false);
    }
    // Só rolagem da JANELA (não captura → não pega a rolagem DENTRO do menu nem
    // o scrollIntoView de testes) e resize: o menu é fixo, então reposicioná-lo
    // seria frágil — melhor fechar.
    function fecharAoMover() {
      setAberto(false);
    }

    document.addEventListener('mousedown', fecharAoClicarFora);
    document.addEventListener('keydown', fecharAoPressarEscape);
    window.addEventListener('scroll', fecharAoMover);
    window.addEventListener('resize', fecharAoMover);

    return () => {
      document.removeEventListener('mousedown', fecharAoClicarFora);
      document.removeEventListener('keydown', fecharAoPressarEscape);
      window.removeEventListener('scroll', fecharAoMover);
      window.removeEventListener('resize', fecharAoMover);
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
        onClick={(ev) => {
          ev.stopPropagation(); // não deixa o clique "subir" e abrir o card
          alternar();
        }}
        onKeyDown={(ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault();
            ev.stopPropagation();
            alternar();
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

      {aberto &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            onClick={(ev) => ev.stopPropagation()}
            style={{ position: 'fixed', top: pos.top, bottom: pos.bottom, right: pos.right }}
            className="z-[2000] min-w-48 max-h-[min(60vh,22rem)] overflow-hidden overflow-y-auto rounded-lg glass-panel border border-white/10 shadow-xl animate-fade-up"
          >
            {itens.map((item, idx) => (
              <button
                key={idx}
                role="menuitem"
                onClick={(ev) => {
                  ev.stopPropagation();
                  executarAcao(item.action);
                }}
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
          </div>,
          document.body,
        )}
    </div>
  );
}
