import { Env } from './types';

export function getBotToken(env: Env): string {
  const token = env.BOT_TOKEN || '';
  return token.trim();
}

export function botLink(env: Env, hatmId?: number): string {
  const uname = (env.BOT_USERNAME || 'nurHatmBot').trim().replace(/^@/, '');
  let link = `https://t.me/${uname}`;
  if (hatmId) {
    link += `?start=hatm_${hatmId}`;
  }
  return link;
}

export async function callTelegram(
  token: string,
  method: string,
  payload: Record<string, unknown>
): Promise<any> {
  if (!token || token.includes('your_telegram_bot_token')) {
    return { ok: false, description: 'BOT_TOKEN is not set' };
  }
  const url = `https://api.telegram.org/bot${token}/${method}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return await res.json();
  } catch (err: any) {
    console.error(`Telegram API error on ${method}:`, err);
    return { ok: false, description: String(err) };
  }
}

export async function sendMessage(
  token: string,
  chatId: number | string,
  text: string,
  replyMarkup?: unknown,
  parseMode: string = 'HTML'
): Promise<any> {
  return callTelegram(token, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: parseMode,
    reply_markup: replyMarkup,
    disable_web_page_preview: true,
  });
}

export async function editMessageText(
  token: string,
  chatId: number | string,
  messageId: number,
  text: string,
  replyMarkup?: unknown,
  parseMode: string = 'HTML'
): Promise<any> {
  return callTelegram(token, 'editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: parseMode,
    reply_markup: replyMarkup,
    disable_web_page_preview: true,
  });
}

export async function deleteMessage(
  token: string,
  chatId: number | string,
  messageId: number
): Promise<any> {
  return callTelegram(token, 'deleteMessage', {
    chat_id: chatId,
    message_id: messageId,
  });
}

export async function answerCallbackQuery(
  token: string,
  callbackQueryId: string,
  text?: string,
  showAlert: boolean = false
): Promise<any> {
  return callTelegram(token, 'answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    text,
    show_alert: showAlert,
  });
}

export async function setWebhook(
  token: string,
  url: string
): Promise<any> {
  return callTelegram(token, 'setWebhook', {
    url,
    drop_pending_updates: true,
  });
}

export async function getMe(token: string): Promise<any> {
  return callTelegram(token, 'getMe', {});
}
