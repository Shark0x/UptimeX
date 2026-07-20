/**
 * Envio de mensagens via Telegram Bot API — sem dependência externa (fetch nativo).
 *
 * Config no .env do backend:
 *   TELEGRAM_BOT_TOKEN  token do bot criado no @BotFather
 *   TELEGRAM_CHAT_ID    id do chat/grupo que recebe os alertas
 *
 * Env é lida de forma preguiçosa (função, não const de módulo) porque o
 * dotenv.config() roda depois dos imports no index.ts.
 */

const token = () => process.env.TELEGRAM_BOT_TOKEN?.trim() || '';
const chatId = () => process.env.TELEGRAM_CHAT_ID?.trim() || '';

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
