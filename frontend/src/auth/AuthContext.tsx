import { createContext, useContext, useEffect, useState } from 'react';
import { api, conectarSocket, desconectarSocket, Usuario } from '../api';
import { limparSnapshotEmpresas } from '../lib/empresasSnapshot';

interface AuthState {
  usuario: Usuario | null;
  isAdmin: boolean;
  carregando: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  atualizarAvatar: (avatar_url: string | null) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    function aoDeslogarForcado() {
      limparSnapshotEmpresas();
      setUsuario(null);
      desconectarSocket();
    }
    window.addEventListener('netmonitor:unauthorized', aoDeslogarForcado);
    api.sessaoAtual()
      .then(({ user }) => {
        setUsuario(user);
        if (user) conectarSocket();
      })
      .catch(() => setUsuario(null))
      .finally(() => setCarregando(false));
    return () => window.removeEventListener('netmonitor:unauthorized', aoDeslogarForcado);
  }, []);

  async function login(username: string, password: string) {
    setCarregando(true);
    try {
      const { user } = await api.login(username, password);
      setUsuario(user);
      conectarSocket();
    } finally {
      setCarregando(false);
    }
  }

  async function logout() {
    try {
      await api.logout();
    } finally {
      desconectarSocket();
      limparSnapshotEmpresas();
      setUsuario(null);
    }
  }

  function atualizarAvatar(avatar_url: string | null) {
    setUsuario((u) => (u ? { ...u, avatar_url } : u));
  }

  return (
    <AuthContext.Provider value={{ usuario, isAdmin: usuario?.role === 'admin', carregando, login, logout, atualizarAvatar }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth precisa estar dentro de AuthProvider');
  return ctx;
}
