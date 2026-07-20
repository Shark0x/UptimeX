/**
 * Paginação clicável: ‹ 1 … 4 [5] 6 … 9 ›
 * Some sozinha quando só existe uma página.
 */
export function Paginacao({
  pagina,
  totalPaginas,
  aoMudar,
}: {
  pagina: number;
  totalPaginas: number;
  aoMudar: (p: number) => void;
}) {
  if (totalPaginas <= 1) return null;

  const itens: (number | '…')[] = [];
  if (totalPaginas <= 7) {
    for (let i = 1; i <= totalPaginas; i++) itens.push(i);
  } else {
    itens.push(1);
    if (pagina > 3) itens.push('…');
    for (let i = Math.max(2, pagina - 1); i <= Math.min(totalPaginas - 1, pagina + 1); i++) itens.push(i);
    if (pagina < totalPaginas - 2) itens.push('…');
    itens.push(totalPaginas);
  }

  const base =
    'w-9 h-9 flex items-center justify-center rounded-lg font-mono text-xs border transition-all duration-150';
  const inativo = 'border-white/10 text-muted hover:text-slate-100 hover:border-white/25';
  const ativo = 'border-signal-500/60 text-signal-400 bg-signal-600/10 shadow-glow-signal';

  return (
    <nav className="flex items-center justify-center gap-1.5 mt-5" aria-label="Paginação">
      <button
        onClick={() => aoMudar(pagina - 1)}
        disabled={pagina === 1}
        aria-label="Página anterior"
        className={`${base} ${inativo} disabled:opacity-35 disabled:pointer-events-none`}
      >
        ‹
      </button>
      {itens.map((item, i) =>
        item === '…' ? (
          <span key={`e${i}`} className="px-0.5 text-muted font-mono text-xs select-none">
            …
          </span>
        ) : (
          <button
            key={item}
            onClick={() => aoMudar(item)}
            aria-current={item === pagina ? 'page' : undefined}
            className={`${base} ${item === pagina ? ativo : inativo}`}
          >
            {item}
          </button>
        )
      )}
      <button
        onClick={() => aoMudar(pagina + 1)}
        disabled={pagina === totalPaginas}
        aria-label="Próxima página"
        className={`${base} ${inativo} disabled:opacity-35 disabled:pointer-events-none`}
      >
        ›
      </button>
    </nav>
  );
}
