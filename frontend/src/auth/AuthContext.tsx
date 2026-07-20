import { createContext, useContext, useEffect, useState } from 'react';
import { api, setAuthToken, Usuario } from '../api';

interface AuthState {
  usuario: Usuario | null;
  isAdmin: boolean;
  carregando: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(() => {
    const raw = localStorage.getItem('netmonitor_user');
    return raw ? JSON.parse(raw) : null;
  });
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    function aoDeslogarForcado() {
      setUsuario(null);
      localStorage.removeItem('netmonitor_user');
    }
    window.addEventListener('netmonitor:unauthorized', aoDeslogarForcado);
    return () => window.removeEventListener('netmonitor:unauthorized', aoDeslogarForcado);
  }, []);

  async function login(username: string, password: string) {
    setCarregando(true);
    try {
      const { token, user } = await api.login(username, password);
      setAuthToken(token);
      localStorage.setItem('netmonitor_user', JSON.stringify(user));
      setUsuario(user);
    } finally {
      setCarregando(false);
    }
  }

  function logout() {
    setAuthToken(null);
    localStorage.removeItem('netmonitor_user');
    setUsuario(null);
  }

  return (
    <AuthContext.Provider value={{ usuario, isAdmin: usuario?.role === 'admin', carregando, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth precisa estar dentro de AuthProvider');
  return ctx;
}
