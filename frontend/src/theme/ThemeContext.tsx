import { createContext, useCallback, useContext, useEffect, useState } from 'react';

export type Tema = 'escuro' | 'claro' | 'cinza';

export const TEMAS: { id: Tema; nome: string; descricao: string }[] = [
  { id: 'escuro', nome: 'Escuro', descricao: 'Padrão — grafite e vermelho-sinal' },
  { id: 'claro', nome: 'Claro', descricao: 'Fundo branco, texto escuro' },
  { id: 'cinza', nome: 'Cinza', descricao: 'Grafite médio, contraste suave' },
];

const CHAVE = 'uptimex_tema';

function temaValido(v: unknown): v is Tema {
  return v === 'escuro' || v === 'claro' || v === 'cinza';
}

/** Lê o tema salvo (mesma chave usada pelo script anti-flash do index.html). */
export function lerTemaSalvo(): Tema {
  try {
    const v = localStorage.getItem(CHAVE);
    if (temaValido(v)) return v;
  } catch {
    /* localStorage indisponível (modo privado) — cai no padrão */
  }
  return 'escuro';
}

function aplicarTema(tema: Tema) {
  document.documentElement.dataset.theme = tema;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    const cor = tema === 'claro' ? '#ffffff' : tema === 'cinza' ? '#1e2127' : '#060607';
    meta.setAttribute('content', cor);
  }
}

interface ContextoTema {
  tema: Tema;
  setTema: (t: Tema) => void;
}

const TemaContext = createContext<ContextoTema | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [tema, definirTema] = useState<Tema>(lerTemaSalvo);

  useEffect(() => {
    aplicarTema(tema);
  }, [tema]);

  const setTema = useCallback((t: Tema) => {
    definirTema(t);
    try {
      localStorage.setItem(CHAVE, t);
    } catch {
      /* sem persistência neste navegador — o tema vale só pra sessão */
    }
  }, []);

  return <TemaContext.Provider value={{ tema, setTema }}>{children}</TemaContext.Provider>;
}

export function useTema(): ContextoTema {
  const ctx = useContext(TemaContext);
  if (!ctx) throw new Error('useTema precisa estar dentro de <ThemeProvider>');
  return ctx;
}
