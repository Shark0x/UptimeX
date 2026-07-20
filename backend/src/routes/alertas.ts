import { Router } from 'express';
import { authMiddleware, requireRole } from '../middleware/auth';
import { enviarTelegram, telegramConfigurado } from '../services/telegramService';

export const alertasRouter = Router();

alertasRouter.use(authMiddleware);

// Estado da configuração — o front usa pra mostrar se os alertas estão ativos
alertasRouter.get('/status', (_req, res) => {
  res.json({ telegramConfigurado: telegramConfigurado() });
});

// Dispara uma mensagem de teste pro chat configurado
alertasRouter.post('/teste', requireRole('admin'), async (_req, res) => {
  if (!telegramConfigurado()) {
    return res.status(400).json({
      erro: 'Telegram não configurado. Defina TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID no backend/.env e reinicie o backend.',
    });
  }
  const ok = await enviarTelegram('✅ <b>uptimeX conectado</b>\nOs alertas de queda vão chegar neste chat.');
  if (!ok) {
    return res.status(502).json({ erro: 'O Telegram recusou o envio — confira o token e o chat id no backend/.env.' });
  }
  res.json({ ok: true });
});
