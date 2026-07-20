import { Request, Response, NextFunction } from 'express';
import { verifyToken, Papel } from '../services/authService';

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ erro: 'Não autenticado' });

  try {
    req.user = verifyToken(token);
    next();
  } catch {
    res.status(401).json({ erro: 'Sessão inválida ou expirada' });
  }
}

export function requireRole(...papeis: Papel[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !papeis.includes(req.user.role)) {
      return res.status(403).json({ erro: 'Sem permissão para esta ação' });
    }
    next();
  };
}
