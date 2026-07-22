import { obterConfig } from './configService';

/**
 * Envio de mensagens via Telegram Bot API — sem dependência externa (fetch nativo).
 *
 * Configuração pela tela Usuários (salva no banco) ou, como alternativa, pelo
 * .env (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID). A UI tem precedência.
 */

const token = () => obterConfig('telegram_bot_token', 'TELEGRAM_BOT_TOKEN');
const chatId = () => obterConfig('telegram_chat_id', 'TELEGRAM_CHAT_ID');

export function telegramConfigurado(): boolean {
  return token() !== '' && chatId() !== '';
}

/** Escapa conteúdo dinâmico pro parse_mode HTML do Telegram. */
export function escaparHtml(texto: string): string {
  return texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function enviarTelegram(textoHtml: string): Promise<boolean> {
  if (!telegramConfigurado()) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token()}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId(), text: textoHtml, parse_mode: 'HTML' }),
    });
    if (!res.ok) {
      const corpo = await res.text().catch(() => '');
      console.error(`Telegram recusou o envio (${res.status}): ${corpo.slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error('Falha ao falar com a API do Telegram:', err);
    return false;
  }
}
