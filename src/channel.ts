import { Env, HatmRow, JuzRow, UserRow } from './types';
import { botLink, getBotToken, sendMessage, editMessageText, deleteMessage } from './telegram';

export function getChannelId(env: Env): string {
  return (env.CHANNEL_ID || '@nurhatmquran').trim();
}

export function getChannelUrl(env: Env): string {
  const ch = getChannelId(env);
  if (ch.startsWith('@')) {
    return `https://t.me/${ch.slice(1)}`;
  }
  if (ch.startsWith('https://t.me/')) {
    return ch;
  }
  return 'https://t.me/nurhatmquran';
}

/**
 * Requirement 7:
 * editMessageText in channel @hatmiquaan formatted as:
 * free -> taken -> done with ✅🕋
 */
export function buildChannelHatmText(
  hatm: HatmRow,
  juzs: JuzRow[],
  topUsers: UserRow[] | UserRow | null
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
      lines.push(`\u200E<b>${num}-пора:</b> \u2068${reader}\u2069\u200E ✅`);
    } else if (j.status === 'booked') {
      const reader = j.user_name || 'Муслим';
      lines.push(`\u200E<b>${num}-пора:</b> \u2068${reader}\u2069\u200E ⏳`);
    } else {
      lines.push(`\u200E<b>${num}-пора:</b>`);
    }
  }
  lines.push('');

  const topList: UserRow[] = Array.isArray(topUsers)
    ? topUsers
    : topUsers
    ? [topUsers]
    : [];

  if (topList.length > 0) {
    if (topList.length === 1) {
      lines.push(`\u200E🏆 <b>Топ:</b> \u2068${topList[0].name}\u2069\u200E — ${topList[0].total_juz} пора`);
    } else {
      lines.push('\u200E🏆 <b>Топ-3:</b>');
      topList.slice(0, 3).forEach((u, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉';
        lines.push(`\u200E${medal} \u2068${u.name}\u2069\u200E — ${u.total_juz} пора`);
      });
    }
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

    const topUsersRes = await env.DB.prepare(
      'SELECT * FROM users WHERE total_juz > 0 ORDER BY rating_points DESC, total_juz DESC LIMIT 3'
    ).all<UserRow>();
    const topUsers = topUsersRes.results || [];

    const text = buildChannelHatmText(hatm, juzs, topUsers);
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
    const formattedReaders = readers.slice(0, 15).map((r) => `\u2068${r}\u2069\u200E`);
    let readersStr = formattedReaders.join(', ');
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

export async function sendSoloHatmToChannel(
  env: Env,
  userName: string
): Promise<number | null> {
  const token = getBotToken(env);
  const channelId = getChannelId(env);
  if (!token || !channelId) return null;

  const lrm = '\u200E';
  const lines: string[] = [
    `🌙 <b>Шахсий Хатми Қуръон</b>`,
    `<i>«Барча мўмин-мусулмонлар ҳаққига бағишланади»</i>\n`,
    `👤 <b>Қори:</b> \u2068${userName}\u2069${lrm}`,
    `📊 <b>30/30 ўқилди</b> (Тўлиқ хатм)`,
    `<code>[🟨🟨🟨🟨🟨🟨🟨🟨🟨🟨]</code>\n`,
  ];

  for (let i = 1; i <= 30; i++) {
    const num = String(i).padStart(2, '0');
    lines.push(`${lrm}<b>${num}-пора:</b> \u2068${userName}\u2069${lrm} ✅`);
  }

  lines.push('\n🤲 <b>Аллоҳим! Ушбу ўқилган Қуръони Карим хатмини Ўз даргоҳингда ҳусни қабул айла! Қоримизга ва барча мўмин-мусулмонларга икки дунё саодатини ато эт! Омин!</b>');

  const keyboard = {
    inline_keyboard: [
      [
        {
          text: '📖 Хатмда қатнашиш',
          url: botLink(env),
        },
      ],
    ],
  };

  try {
    const res = await sendMessage(token, channelId, lines.join('\n'), keyboard);
    if (res && res.ok && res.result?.message_id) {
      return res.result.message_id;
    }
  } catch (err: any) {
    console.error('sendSoloHatmToChannel error:', err);
  }
  return null;
}
