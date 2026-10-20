import { Env, HatmRow, JuzRow, UserRow } from './types';
import { botLink, getBotToken, sendMessage, editMessageText, deleteMessage } from './telegram';

export function getChannelId(env: Env): string {
  return (env.CHANNEL_ID || '@hatmiquaan').trim();
}

/**
 * Requirement 7:
 * editMessageText in channel @hatmiquaan formatted as:
 * free -> taken -> done with ✅🕋
 */
export function buildChannelHatmText(
  hatm: HatmRow,
  juzs: JuzRow[],
  topUser: UserRow | null
): string {
  const sorted = [...juzs].sort((a, b) => a.number - b.number);
  const doneCount = sorted.filter((j) => j.status === 'done').length;
  const bookedCount = sorted.filter((j) => j.status === 'booked').length;
  const freeCount = sorted.filter((j) => j.status === 'free').length;

  const filledBlocks = Math.floor(doneCount / 3);
  const bookedBlocks = Math.floor(bookedCount / 3);
  let bar = '🟨'.repeat(filledBlocks) + '🟩'.repeat(bookedBlocks);
  bar = (bar + '⬜'.repeat(10)).slice(0, 10);

  const lines: string[] = [
    `🌙 <b>${hatm.title}</b>`,
  ];
  if (hatm.dedication) {
    lines.push(`<i>«${hatm.dedication}»</i>`);
  }
  lines.push('');
  lines.push(`📊 ${doneCount}/30 ўқилди • ⏳ ${bookedCount} банд • ⚪ ${freeCount} бўш`);
  lines.push(`<code>[${bar}]</code>\n`);

  for (const j of sorted) {
    const num = String(j.number).padStart(2, '0');
    if (j.status === 'done') {
      const reader = j.user_name || 'Муслим';
      lines.push(`✅ <b>${num}-пора:</b> ${reader} 🕋`);
    } else if (j.status === 'booked') {
      const reader = j.user_name || 'Муслим';
      lines.push(`⏳ <b>${num}-пора:</b> ${reader}`);
    } else {
      lines.push(`⚪ <b>${num}-пора:</b> Бўш`);
    }
  }
  lines.push('');

  if (topUser && topUser.total_juz > 0) {
    lines.push(`🏆 Топ: ${topUser.name} — ${topUser.total_juz} пора`);
  }

  return lines.join('\n');
}

export function buildChannelKeyboard(env: Env, hatmId: number): any {
  return {
    inline_keyboard: [
      [
        {
          text: '📖 Пора олиш',
          url: botLink(env, hatmId),
        },
      ],
    ],
  };
}

export async function syncChannelBoard(
  env: Env,
  hatmId?: number
): Promise<void> {
  const token = getBotToken(env);
  const channelId = getChannelId(env);
  if (!token || !channelId) return;

  try {
    // 1. Fetch hatm & juzs
    let hatm: HatmRow | null = null;
    if (hatmId) {
      hatm = await env.DB.prepare('SELECT * FROM hatms WHERE id = ?').bind(hatmId).first<HatmRow>();
    } else {
      hatm = await env.DB.prepare('SELECT * FROM hatms WHERE status = "active" ORDER BY number DESC LIMIT 1').first<HatmRow>();
    }
    if (!hatm) return;

    const juzsResult = await env.DB.prepare('SELECT * FROM juzs WHERE hatm_id = ? ORDER BY number ASC').bind(hatm.id).all<JuzRow>();
    const juzs = juzsResult.results || [];

    const topUser = await env.DB.prepare('SELECT * FROM users WHERE total_juz > 0 ORDER BY rating_points DESC, total_juz DESC LIMIT 1').first<UserRow>();

    const text = buildChannelHatmText(hatm, juzs, topUser);
    const keyboard = buildChannelKeyboard(env, hatm.id);

    if (hatm.channel_message_id) {
      const res = await editMessageText(token, channelId, hatm.channel_message_id, text, keyboard);
      if (res && res.ok === false) {
        const desc = (res.description || '').toLowerCase();
        if (desc.includes('message to edit not found') || desc.includes('chat not found')) {
          // Send fresh message and save ID
          const sendRes = await sendMessage(token, channelId, text, keyboard);
          if (sendRes && sendRes.ok && sendRes.result?.message_id) {
            await env.DB.prepare('UPDATE hatms SET channel_message_id = ? WHERE id = ?')
              .bind(sendRes.result.message_id, hatm.id)
              .run();
          }
        }
      }
    } else {
      const sendRes = await sendMessage(token, channelId, text, keyboard);
      if (sendRes && sendRes.ok && sendRes.result?.message_id) {
        await env.DB.prepare('UPDATE hatms SET channel_message_id = ? WHERE id = ?')
          .bind(sendRes.result.message_id, hatm.id)
          .run();
      }
    }
  } catch (err: any) {
    console.error('syncChannelBoard error:', err);
  }
}

export async function deleteChannelPost(env: Env, messageId?: number | null): Promise<void> {
  const token = getBotToken(env);
  const channelId = getChannelId(env);
  if (!token || !channelId || !messageId) return;
  try {
    await deleteMessage(token, channelId, messageId);
  } catch (err: any) {
    console.warn(`Could not delete channel post ${messageId}:`, err);
  }
}

export async function sendGroupDua(
  env: Env,
  hatm: HatmRow,
  newHatm?: HatmRow | null
): Promise<void> {
  const token = getBotToken(env);
  const channelId = getChannelId(env);
  if (!token || !channelId) return;

  const duaText = (hatm.dua_message || '').trim() ||
    'Аллоҳим! Ушбу ўқилган Қуръони Карим оятларининг нури ва савобини ' +
    'Пайғамбаримиз Муҳаммад Мустафо ﷺ руҳи покларига, барча ўтган мўмин-мусулмонлар ' +
    'руҳига ҳамда хатмда қатнашган қори ва қорияларимизнинг икки дунё саодатига ' +
    'васила қилгин! Омин!';

  // Get distinct readers who completed Juzs in this Hatm
  const doneResult = await env.DB.prepare(
    'SELECT DISTINCT user_name FROM juzs WHERE hatm_id = ? AND status = "done" AND user_name IS NOT NULL'
  ).bind(hatm.id).all<{ user_name: string }>();

  const readers = (doneResult.results || []).map((r) => r.user_name);

  const lines: string[] = [
    `🤲 <b>${hatm.title} Дуоси</b>\n`,
    `<i>«${duaText}»</i>\n`,
  ];
  if (readers.length > 0) {
    let readersStr = readers.slice(0, 15).join(', ');
    if (readers.length > 15) {
      readersStr += ` ва яна ${readers.length - 15} киши`;
    }
    lines.push(`✨ <b>Қатнашганлар:</b> ${readersStr}\n`);
  }
  lines.push('🤲 Аллоҳ қабул қилсин! Омин!');

  const keyboard = newHatm
    ? {
        inline_keyboard: [
          [
            {
              text: `📖 ${newHatm.title}га қўшилиш`,
              url: botLink(env, newHatm.id),
            },
          ],
        ],
      }
    : undefined;

  try {
    await sendMessage(token, channelId, lines.join('\n'), keyboard);
  } catch (err: any) {
    console.error('sendGroupDua error:', err);
  }
}
