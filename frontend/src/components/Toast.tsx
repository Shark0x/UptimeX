import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

/**
 * Toasts globais: confirmação de ações e falhas inesperadas.
 * Erros de validação de formulário continuam inline, perto do campo —
 * toast é pro desfecho da ação ("Empresa criada", "Falha ao salvar").
 */

type TomToast = 'sucesso' | 'erro' | 'info';

interface ToastItem {
  id: number;
  texto: string;
  tom: TomToast;
  saindo?: boolean;
}

interface ToastApi {
  sucesso: (texto: string) => void;
  erro: (texto: string) => void;
  info: (texto: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast precisa estar dentro de <ToastProvider>');
  return ctx;
}

const ESTILO_POR_TOM: Record<TomToast, { borda: string; ponto: string }> = {
  sucesso: { borda: 'border-online/40', ponto: 'bg-online' },
  erro: { borda: 'border-signal-500/50', ponto: 'bg-offline' },
  info: { borda: 'border-white/15', ponto: 'bg-slate-300' },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const proximoId = useRef(1);

  const remover = useCallback((id: number) => {
    setToasts((ts) => ts.map((t) => (t.id === id ? { ...t, saindo: true } : t)));
    setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), 200);
  }, []);

  const exibir = useCallback(
    (texto: string, tom: TomToast) => {
      const id = proximoId.current++;
      // No máximo 4 na pilha — o mais antigo cede lugar
      setToasts((ts) => [...ts.slice(-3), { id, texto, tom }]);
      setTimeout(() => remover(id), 4000);
    },
    [remover]
  );

  const api = useMemo<ToastApi>(
    () => ({
      sucesso: (t) => exibir(t, 'sucesso'),
      erro: (t) => exibir(t, 'erro'),
      info: (t) => exibir(t, 'info'),
    }),
    [exibir]
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="fixed bottom-4 right-4 z-[100] flex flex-col items-end gap-2 pointer-events-none max-w-[calc(100vw-2rem)]"
      >
        {toasts.map((t) => {
          const estilo = ESTILO_POR_TOM[t.tom];
          return (
            <button
              key={t.id}
              onClick={() => remover(t.id)}
              className={`pointer-events-auto flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-left
                bg-deep-900/95 backdrop-blur-xl border ${estilo.borda} shadow-glass
                font-grotesk text-sm text-slate-100
                ${t.saindo ? 'toast-sai' : 'toast-entra'}`}
            >
              <span className={`w-2 h-2 rounded-full shrink-0 ${estilo.ponto}`} />
              {t.texto}
            </button>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
