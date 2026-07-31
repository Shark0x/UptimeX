import { Router } from 'express';
import { authMiddleware, requireRole } from '../middleware/auth';
import { obterConfig, salvarConfig } from '../services/configService';
import { enviarTelegram, telegramConfigurado } from '../services/telegramService';
import { enviarResumo, obterConfigResumo, PeriodoResumo } from '../services/resumoService';
import { registrarAuditoria } from '../services/auditService';

export const alertasRouter = Router();

alertasRouter.use(authMiddleware);

// Estado + valores atuais pra pré-preencher o formulário. O token NUNCA é
// devolvido (é segredo); só informamos se já existe um definido.
alertasRouter.get('/status', (_req, res) => {
  res.json({
    telegramConfigurado: telegramConfigurado(),
    tokenDefinido: obterConfig('telegram_bot_token', 'TELEGRAM_BOT_TOKEN') !== '',
    chatId: obterConfig('telegram_chat_id', 'TELEGRAM_CHAT_ID'),
    atrasoSeg: Number(obterConfig('alerta_atraso_seg', 'ALERTA_ATRASO_SEG')) || 120,
    resumo: obterConfigResumo(),
  });
});

// Salva a configuração dos resumos periódicos (admin)
alertasRouter.post('/resumo/config', requireRole('admin'), async (req, res) => {
  const { diarioAtivo, diarioHora, semanalAtivo, semanalDia, semanalHora } = req.body ?? {};

  const hora = (v: unknown) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= 0 && n <= 23 ? n : null;
  };
  const dh = hora(diarioHora);
  const sh = hora(semanalHora);
  const sd = Number(semanalDia);
  if (dh === null || sh === null || !Number.isInteger(sd) || sd < 0 || sd > 6) {
    return res.status(400).json({ erro: 'Hora deve ser 0–23 e o dia da semana 0 (dom) a 6 (sáb).' });
  }

  await salvarConfig({
    resumo_diario_ativo: diarioAtivo ? '1' : '0',
    resumo_diario_hora: String(dh),
    resumo_semanal_ativo: semanalAtivo ? '1' : '0',
    resumo_semanal_dia: String(sd),
    resumo_semanal_hora: String(sh),
  });
  await registrarAuditoria(req.user!.username, 'editar', 'config', null, 'Atualizou os resumos periódicos do Telegram');
  res.json({ ok: true, resumo: obterConfigResumo() });
});

// Envia um resumo na hora, pra testar/pré-visualizar (admin)
alertasRouter.post('/resumo/enviar', requireRole('admin'), async (req, res) => {
  if (!telegramConfigurado()) {
    return res.status(400).json({ erro: 'Telegram não configurado. Preencha o token e o chat id acima e salve.' });
  }
  const periodo: PeriodoResumo = req.body?.periodo === 'semanal' ? 'semanal' : 'diario';
  const ok = await enviarResumo(periodo);
  if (!ok) return res.status(502).json({ erro: 'O Telegram recusou o envio — confira o token e o chat id.' });
  res.json({ ok: true });
});

// Salva a configuração dos alertas pela interface (admin)
alertasRouter.post('/config', requireRole('admin'), async (req, res) => {
  const { bot_token, chat_id, alerta_atraso_seg } = req.body ?? {};
  const atraso = Number(alerta_atraso_seg);
  if (!Number.isFinite(atraso) || atraso < 10 || atraso > 3600) {
    return res.status(400).json({ erro: 'O tempo até alertar deve ser um número entre 10 e 3600 segundos.' });
  }

  const entradas: Record<string, string> = {
    telegram_chat_id: typeof chat_id === 'string' ? chat_id.trim() : '',
    alerta_atraso_seg: String(Math.round(atraso)),
  };
  // Token só é gravado quando informado — em branco, mantém o atual (write-only)
  if (typeof bot_token === 'string' && bot_token.trim() !== '') {
    entradas.telegram_bot_token = bot_token.trim();
  }

  await salvarConfig(entradas);
  await registrarAuditoria(req.user!.username, 'editar', 'config', null, 'Atualizou configuração de alertas do Telegram');
  res.json({ ok: true, telegramConfigurado: telegramConfigurado() });
});

// Dispara uma mensagem de teste pro chat configurado
alertasRouter.post('/teste', requireRole('admin'), async (_req, res) => {
  if (!telegramConfigurado()) {
    return res.status(400).json({ erro: 'Telegram não configurado. Preencha o token e o chat id acima e salve.' });
  }
  const ok = await enviarTelegram('✅ <b>uptimeX conectado</b>\nOs alertas de queda vão chegar neste chat.');
  if (!ok) {
    return res.status(502).json({ erro: 'O Telegram recusou o envio — confira o token e o chat id.' });
  }
  res.json({ ok: true });
});
