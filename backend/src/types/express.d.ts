import { UsuarioAutenticado } from '../services/authService';

declare global {
  namespace Express {
    interface Request {
      user?: UsuarioAutenticado;
      authSource?: 'cookie' | 'bearer';
    }
  }
}

export {};
