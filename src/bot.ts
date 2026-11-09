import { Env, HatmRow, JuzRow, UserRow } from './types';
import { getBotToken, sendMessage, editMessageText, deleteMessage, answerCallbackQuery } from './telegram';
import {
  getOrCreateUser,
  getActiveHatm,
  getLeaderboard,
  isAdminUser,
  adminPerformDua,
  ensureInitialized,
  adminResetUserStats,
  adminResetAllLeaderboard,
  getAllAdminIds,
  createSoloHatmRequest,
  approveSoloHatm,
  rejectSoloHatm,
} from './db';
import { getChannelUrl } from './channel';

export function getMainKeyboard(env: Env, webappUrl: string, isAdmin: boolean): any {
  const url = webappUrl || 'https://nur-hatm-bot.vercel.app';
  const channelUrl = getChannelUrl(env);
  const buttons: any[] = [
    [
      {
        text: '📖 Пора олиш',
        web_app: { url },
      },
    ],
    [
      {
        text: '🏆 Топ-10 Рейтинг',
        callback_data: 'show_leaderboard',
      },
      {
        text: '⏳ Пораларим',
        callback_data: 'my_juzs',
      },
    ],
    [
      {
        text: '🌙 Тўлиқ хатм қилдим',
        callback_data: 'solo_hatm_prompt',
      },
    ],
    [
      {
        text: '📢 Каналимиз (@nurhatmquran)',
        url: channelUrl,
      },
    ],
  ];

  if (isAdmin) {
    buttons.push([
      {
        text: '🔔 Хатм Дуоси',
        callback_data: 'admin_dua_confirm',
      },
      {
        text: '👑 Админ Панел',
        web_app: { url: `${url}?tab=admin` },
      },
    ]);
  }

  return { inline_keyboard: buttons };
}

export function formatWelcomeText(user: UserRow, hatm: HatmRow, juzs: JuzRow[]): string {
  const doneCount = juzs.filter((j) => j.status === 'done').length;
  const freeCount = juzs.filter((j) => j.status === 'free').length;
  return (
    `🌙 <b>${hatm.title}</b>\n\n` +
    `📊 ${doneCount}/30 ўқилди • ${freeCount} та бўш\n` +
    `🌟 Сизда: <b>${user.rating_points} балл</b> (${user.total_juz} пора)`
  );
}

export async function handleTelegramWebhook(
  request: Request,
  env: Env,
  ctx: any
): Promise<Response> {
  const token = getBotToken(env);
  if (!token) {
    return new Response('Bot token not configured', { status: 200 });
  }

  let update: any;
  try {
    update = await request.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  await ensureInitialized(env.DB, env);

  const webappUrl = env.WEBAPP_URL || new URL(request.url).origin;

  // 1. Handle Callback Queries
  if (update.callback_query) {
    const cb = update.callback_query;
    const fromUser = cb.from;
    const msg = cb.message;
    const data = cb.data;

    if (!fromUser || !msg) {
      await answerCallbackQuery(token, cb.id);
      return new Response('ok');
    }

    const user = await getOrCreateUser(env.DB, env, fromUser.id, fromUser.first_name, fromUser.username);
    const { hatm, juzs } = await getActiveHatm(env.DB);
    const isAdmin = isAdminUser(env, user);

    if (data === 'show_leaderboard') {
      const lb = await getLeaderboard(env.DB, 10);
      const lines = ['🏆 <b>Жаннат боғининг энг фаоллари (Топ-10)</b>\n'];
      const medals: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };
      for (const u of lb.top_users) {
        const m = medals[u.rank] || `<b>${u.rank}.</b>`;
        lines.push(`\u200E${m} <b>\u2068${u.name}\u2069</b>\u200E — ${u.total_juz} пора • <b>${u.rating_points} балл</b>`);
      }
      if (lb.top_users.length === 0) {
        lines.push('Ҳозирча ўқилган поралар йўқ. Биринчи бўлиб савоб олинг!');
      }
      lines.push(`\n✨ Жами ўқилган: <b>${lb.total_completed_juzs} та пора</b>`);

      const kb = {
        inline_keyboard: [
          [{ text: '📖 Пора олиш', web_app: { url: webappUrl } }],
          [
            { text: '📢 Каналга ўтиш', url: getChannelUrl(env) },
            { text: '◀️ Ортга', callback_data: 'back_to_main' },
          ],
        ],
      };

      await editMessageText(token, msg.chat.id, msg.message_id, lines.join('\n'), kb);
      await answerCallbackQuery(token, cb.id);
      return new Response('ok');
    }

    if (data === 'my_juzs') {
      const myBooked = juzs.filter((j) => j.user_id === user.id && j.status === 'booked');
      const myDone = juzs.filter((j) => j.user_id === user.id && j.status === 'done');

      const bookedStr = myBooked.length > 0 ? myBooked.map((j) => `${j.number}-пора`).join(', ') : 'Йўқ';
      const doneStr = myDone.length > 0 ? myDone.map((j) => `${j.number}-пора`).join(', ') : 'Йўқ';

      const text =
        `👤 <b>\u2068${user.name}\u2069</b>\u200E\n\n` +
        `🌟 <b>${user.rating_points} балл</b> • ${user.total_juz} пора (${user.total_hatm} хатм)\n\n` +
        `⏳ <b>Банд:</b> ${bookedStr}\n` +
        `✅ <b>Ўқилди:</b> ${doneStr}`;

      const kb = {
        inline_keyboard: [
          [{ text: '📖 Иловани очиш', web_app: { url: webappUrl } }],
          [
            { text: '📢 Каналга ўтиш', url: getChannelUrl(env) },
            { text: '◀️ Ортга', callback_data: 'back_to_main' },
          ],
        ],
      };

      await editMessageText(token, msg.chat.id, msg.message_id, text, kb);
      await answerCallbackQuery(token, cb.id);
      return new Response('ok');
    }

    if (data === 'back_to_main' || data === 'admin_dua_cancel') {
      const text = formatWelcomeText(user, hatm, juzs);
      const kb = getMainKeyboard(env, webappUrl, isAdmin);
      await editMessageText(token, msg.chat.id, msg.message_id, text, kb);
      await answerCallbackQuery(token, cb.id);
      return new Response('ok');
    }

    if (data === 'admin_dua_confirm') {
      if (!isAdmin) {
        await answerCallbackQuery(token, cb.id, 'Фақат админлар учун!', true);
        return new Response('ok');
      }
      const doneCount = juzs.filter((j) => j.status === 'done').length;
      const text =
        `🔔 <b>${hatm.title} Дуоси</b>\n\n` +
        `Ҳолат: ${doneCount}/30 ўқилди\n\n` +
        `Дуони гуруҳга юбориш ва янги хатмни очишни тасдиқлайсизми?`;

      const kb = {
        inline_keyboard: [
          [{ text: '🤲 Ҳа, Дуо қилиш ва янги хатм очиш', callback_data: 'admin_dua_execute' }],
          [{ text: '❌ Бекор қилиш', callback_data: 'back_to_main' }],
        ],
      };

      await editMessageText(token, msg.chat.id, msg.message_id, text, kb);
      await answerCallbackQuery(token, cb.id);
      return new Response('ok');
    }

    if (data === 'admin_dua_execute') {
      if (!isAdmin) {
        await answerCallbackQuery(token, cb.id, 'Фақат админлар учун!', true);
        return new Response('ok');
      }
      const res = await adminPerformDua(env.DB, env, user.id, hatm.id, undefined, true);
      const text =
        `🤲 <b>${res.finishedHatm.title} Дуоси гуруҳга юборилди!</b>\n\n` +
        `<i>«${res.finishedHatm.dua_message}»</i>\n\n` +
        `✨ Янги <b>${res.activeHatm.title}</b> очилди.`;

      const kb = getMainKeyboard(env, webappUrl, true);
      await editMessageText(token, msg.chat.id, msg.message_id, text, kb);
      await answerCallbackQuery(token, cb.id, '🤲 Дуо гуруҳга юборилди!');
      return new Response('ok');
    }

    // 1e. Solo Khatm (User claims full 30-juz Khatm)
    if (data === 'solo_hatm_prompt') {
      const text =
        `🌙 <b>Тўлиқ Хатми Қуръонни тасдиқлаш</b>\n\n` +
        `Сиз Қуръони Каримнинг 30 та порасини тўлиқ ўзингиз мустақил ўқиб тамомладингизми?\n\n` +
        `<i>Тасдиқласангиз, аризангиз админларга юборилади. Админ тасдиқлагач, гуруҳга 30 та поралик шахсий хатмингиз эълон қилинади ҳамда ҳисобингизга <b>+300 савоб балл (+1 хатм)</b> қўшилади.</i>`;

      const kb = {
        inline_keyboard: [
          [{ text: '✅ Ҳа, тўлиқ ўқиб тамомладим', callback_data: 'solo_hatm_confirm' }],
          [{ text: '◀️ Бекор қилиш', callback_data: 'back_to_main' }],
        ],
      };

      await editMessageText(token, msg.chat.id, msg.message_id, text, kb);
      await answerCallbackQuery(token, cb.id);
      return new Response('ok');
    }

    if (data === 'solo_hatm_confirm') {
      const res = await createSoloHatmRequest(env.DB, user.id, user.name, user.username);
      if (!res.success) {
        if (res.reason === 'pending_exists') {
          await answerCallbackQuery(token, cb.id, 'Сизда аллақачон кўриб чиқилаётган ариза мавжуд!', true);
          return new Response('ok');
        }
        await answerCallbackQuery(token, cb.id, 'Хатолик юз берди', true);
        return new Response('ok');
      }

      const solo = res.soloHatm!;
      const text =
        `✅ <b>Аризангиз қабул қилинди!</b>\n\n` +
        `⏳ <b>Илтимос, админ тасдиқлашини кутинг.</b>\n\n` +
        `Админ текшириб тасдиқлаганидан сўнг сизга бу ҳақда хабар юборилади, савоб балларингиз (+300 балл, +1 хатм) ҳисобланади ҳамда 30 поралик шахсий хатмингиз гуруҳга эълон қилинади.`;

      const kb = {
        inline_keyboard: [
          [{ text: '◀️ Бош меню', callback_data: 'back_to_main' }],
        ],
      };

      await editMessageText(token, msg.chat.id, msg.message_id, text, kb);
      await answerCallbackQuery(token, cb.id, 'Аризангиз юборилди!');

      // Send alert to all admins
      const adminIds = await getAllAdminIds(env.DB, env);
      const adminText =
        `🌙 <b>Янги Шахсий Хатм аризаси!</b>\n\n` +
        `👤 <b>Қори:</b> \u2068${user.name}\u2069\u200E ${user.username ? '(@' + user.username + ')' : ''}\n` +
        `🆔 <b>ID:</b> <code>${user.id}</code>\n` +
        `📊 <b>Ҳолати:</b> ${user.total_hatm} хатм • ${user.total_juz} пора (${user.rating_points} балл)\n\n` +
        `<i>Қори Қуръоннинг 30 порасини мустақил тўлиқ ўқиб тамомлаганини билдирди. Ушбу шахсий хатмни тасдиқлайсизми?</i>`;

      const adminKb = {
        inline_keyboard: [
          [{ text: '✅ Тасдиқлаш (Гуруҳга чиқариш)', callback_data: `solo_approve_${solo.id}` }],
          [{ text: '❌ Рад этиш', callback_data: `solo_reject_${solo.id}` }],
        ],
      };

      for (const aid of adminIds) {
        ctx.waitUntil(sendMessage(token, aid, adminText, adminKb));
      }

      return new Response('ok');
    }

    if (data.startsWith('solo_approve_')) {
      if (!isAdmin) {
        await answerCallbackQuery(token, cb.id, 'Фақат админлар учун!', true);
        return new Response('ok');
      }
      const soloId = parseInt(data.replace('solo_approve_', ''), 10);
      if (isNaN(soloId)) {
        await answerCallbackQuery(token, cb.id, 'Нотўғри ID', true);
        return new Response('ok');
      }

      const res = await approveSoloHatm(env.DB, env, soloId, user.id);
      if (!res.success) {
        if (res.reason === 'already_processed') {
          await answerCallbackQuery(token, cb.id, 'Ушбу ариза аллақачон кўриб чиқилган!', true);
          return new Response('ok');
        }
        await answerCallbackQuery(token, cb.id, 'Хатолик: ' + (res.reason || ''), true);
        return new Response('ok');
      }

      const solo = res.soloHatm!;
      const text =
        `✅ <b>Шахсий Хатм тасдиқланди ва гуруҳга чиқарилди!</b>\n\n` +
        `👤 <b>Қори:</b> \u2068${solo.user_name}\u2069\u200E\n` +
        `🛡 <b>Тасдиқлади:</b> \u2068${user.name}\u2069\u200E`;

      await editMessageText(token, msg.chat.id, msg.message_id, text);
      await answerCallbackQuery(token, cb.id, 'Шахсий хатм тасдиқланди ва чиқарилди!');

      // Notify the reader in private chat
      const userText =
        `🎉 <b>Табриклаймиз!</b>\n\n` +
        `Сизнинг 30 поралик шахсий хатмингиз админ томонидан тасдиқланди ва гуруҳга эълон қилинди!\n\n` +
        `🌟 Ҳисобингизга <b>+300 савоб балл</b> ҳамда <b>+1 хатм</b> қўшилди!\n\n` +
        `🤲 <i>Аллоҳ таоло ўқилган хатмни даргоҳида ҳусни қабул айласин!</i>`;

      const userKb = {
        inline_keyboard: [
          [{ text: '📢 Гуруҳда кўриш', url: getChannelUrl(env) }],
          [{ text: '📖 Иловани очиш', web_app: { url: webappUrl } }],
        ],
      };
      ctx.waitUntil(sendMessage(token, solo.user_id, userText, userKb));

      return new Response('ok');
    }

    if (data.startsWith('solo_reject_')) {
      if (!isAdmin) {
        await answerCallbackQuery(token, cb.id, 'Фақат админлар учун!', true);
        return new Response('ok');
      }
      const soloId = parseInt(data.replace('solo_reject_', ''), 10);
      if (isNaN(soloId)) {
        await answerCallbackQuery(token, cb.id, 'Нотўғри ID', true);
        return new Response('ok');
      }

      const res = await rejectSoloHatm(env.DB, soloId, user.id);
      if (!res.success) {
        if (res.reason === 'already_processed') {
          await answerCallbackQuery(token, cb.id, 'Ушбу ариза аллақачон кўриб чиқилган!', true);
          return new Response('ok');
        }
        await answerCallbackQuery(token, cb.id, 'Хатолик юз берди', true);
        return new Response('ok');
      }

      const solo = res.soloHatm!;
      const text =
        `❌ <b>Шахсий Хатм аризаси рад этилди.</b>\n\n` +
        `👤 <b>Қори:</b> \u2068${solo.user_name}\u2069\u200E\n` +
        `🛡 <b>Рад этди:</b> \u2068${user.name}\u2069\u200E`;

      await editMessageText(token, msg.chat.id, msg.message_id, text);
      await answerCallbackQuery(token, cb.id, 'Ариза рад этилди.');

      // Notify the reader
      const userText =
        `ℹ️ <b>Шахсий хатм аризангиз бўйича:</b>\n\n` +
        `Сиз юборган тўлиқ хатм аризаси админ томонидан рад этилди.`;
      ctx.waitUntil(sendMessage(token, solo.user_id, userText));

      return new Response('ok');
    }

    await answerCallbackQuery(token, cb.id);
    return new Response('ok');
  }

  // 2. Handle Messages
  if (update.message) {
    const msg = update.message;
    const chatId = msg.chat.id;
    const isPrivate = msg.chat.type === 'private';
    const text = (msg.text || '').trim();

    // 2a. Auto-delete service messages (users join/leave, pinned messages) in groups
    if (
      msg.new_chat_members ||
      msg.left_chat_member ||
      msg.pinned_message ||
      msg.new_chat_title ||
      msg.new_chat_photo ||
      msg.delete_chat_photo
    ) {
      ctx.waitUntil(deleteMessage(token, chatId, msg.message_id));
      return new Response('ok');
    }

    // 2b. /start command
    if (text.startsWith('/start')) {
      const fromUser = msg.from;
      if (!fromUser) return new Response('ok');

      const user = await getOrCreateUser(env.DB, env, fromUser.id, fromUser.first_name, fromUser.username);
      const { hatm, juzs } = await getActiveHatm(env.DB);
      const isAdmin = isAdminUser(env, user);

      // Check last menu message to auto-delete
      const stateKey = `last_menu_${fromUser.id}`;
      const prevMsg = await env.DB.prepare('SELECT value FROM bot_state WHERE key = ?').bind(stateKey).first<{ value: string }>();
      if (prevMsg && prevMsg.value) {
        ctx.waitUntil(deleteMessage(token, chatId, parseInt(prevMsg.value, 10)));
      }

      // Clean up user's incoming /start message immediately in all chats (private and groups)
      ctx.waitUntil(deleteMessage(token, chatId, msg.message_id));

      const welcome = formatWelcomeText(user, hatm, juzs);
      const kb = getMainKeyboard(env, webappUrl, isAdmin);

      const sendRes = await sendMessage(token, chatId, welcome, kb);
      if (sendRes && sendRes.ok && sendRes.result?.message_id) {
        await env.DB.prepare(`
          INSERT INTO bot_state (key, value) VALUES (?, ?)
          ON CONFLICT(key) DO UPDATE SET value = ?
        `).bind(stateKey, String(sendRes.result.message_id), String(sendRes.result.message_id)).run();
      }

      return new Response('ok');
    }

    // 2c. /admins command
    if (text.startsWith('/admins')) {
      const fromUser = msg.from;
      if (!fromUser) return new Response('ok');

      const user = await getOrCreateUser(env.DB, env, fromUser.id);
      if (user.is_super_admin !== 1 && user.is_admin !== 1) {
        await sendMessage(token, chatId, '🔒 Ушбу буйруқ фақат <b>Super Admin</b> учун.');
        return new Response('ok');
      }

      const parts = text.split(/\s+/);
      if (parts.length >= 3 && (parts[1].toLowerCase() === 'add' || parts[1] === '+')) {
        const targetId = parseInt(parts[2], 10);
        if (isNaN(targetId)) {
          await sendMessage(token, chatId, '❌ ID фақат рақам бўлиши керак.');
          return new Response('ok');
        }
        const targetName = parts.slice(3).join(' ') || `Admin #${targetId}`;
        await env.DB.prepare(`
          INSERT INTO users (id, name, is_admin, is_super_admin) VALUES (?, ?, 1, 0)
          ON CONFLICT(id) DO UPDATE SET is_admin = 1
        `).bind(targetId, targetName).run();
        await sendMessage(token, chatId, `✅ <b>${targetName}</b> (<code>${targetId}</code>) админ этиб тайинланди!`);
        return new Response('ok');
      }

      if (parts.length >= 3 && (parts[1].toLowerCase() === 'remove' || parts[1] === 'del' || parts[1] === '-')) {
        const targetId = parseInt(parts[2], 10);
        if (isNaN(targetId)) {
          await sendMessage(token, chatId, '❌ ID фақат рақам бўлиши керак.');
          return new Response('ok');
        }
        await env.DB.prepare('UPDATE users SET is_admin = 0 WHERE id = ?').bind(targetId).run();
        await sendMessage(token, chatId, `🗑 <code>${targetId}</code> админликдан олинди.`);
        return new Response('ok');
      }

      const adminUsersRes = await env.DB.prepare('SELECT * FROM users WHERE (is_admin = 1 OR is_super_admin = 1) AND id NOT IN (123456789, 1234567)').all<UserRow>();
      const list = adminUsersRes.results || [];
      const lines = ['👑 <b>Админлар рўйхати:</b>\n'];
      for (const a of list) {
        const badge = a.is_super_admin === 1 ? '🌟 Super Admin' : '🛡 Admin';
        lines.push(`• <b>\u2068${a.name}\u2069</b>\u200E (<code>${a.id}</code>) — ${badge}`);
      }
      lines.push('\n<i>Қўшиш: /admins add [ID] [Исм]\nЎчириш: /admins remove [ID]</i>');
      await sendMessage(token, chatId, lines.join('\n'));
      return new Response('ok');
    }

    // 2c2. /reset_top and /reset_user commands (Admin only)
    if (text.startsWith('/reset_top') || text.startsWith('/reset_user')) {
      const fromUser = msg.from;
      if (!fromUser) return new Response('ok');

      const user = await getOrCreateUser(env.DB, env, fromUser.id);
      if (user.is_super_admin !== 1 && user.is_admin !== 1) {
        await sendMessage(token, chatId, '🔒 Ушбу буйруқ фақат <b>Админлар</b> учун.');
        return new Response('ok');
      }

      if (text.startsWith('/reset_user')) {
        const parts = text.split(/\s+/);
        const targetId = parseInt(parts[1], 10);
        if (isNaN(targetId)) {
          await sendMessage(token, chatId, '❌ Фойдаланувчи Telegram ID рақамини кўрсатинг:\nМасалан: <code>/reset_user 12345678</code>');
          return new Response('ok');
        }
        const res = await adminResetUserStats(env.DB, env, fromUser.id, targetId, false);
        await sendMessage(token, chatId, res.message);
        return new Response('ok');
      }

      if (text.startsWith('/reset_top')) {
        const res = await adminResetAllLeaderboard(env.DB, env, fromUser.id);
        await sendMessage(token, chatId, res.message);
        return new Response('ok');
      }
    }

    // 2d. Clean Chat Enforcer: Any random text is answered with a button tip,
    // and both the tip and the user message are auto-deleted after 4 seconds!
    const kb = {
      inline_keyboard: [[{ text: '📖 Пора олиш', web_app: { url: webappUrl } }]],
    };
    const tipRes = await sendMessage(
      token,
      chatId,
      '✨ <b>Пора танлаш фақат тугма орқали</b> (ёзиш шарт эмас) 👇',
      kb
    );

    if (tipRes && tipRes.ok && tipRes.result?.message_id) {
      const tipId = tipRes.result.message_id;
      const userMsgId = msg.message_id;

      // 4-second guaranteed auto-delete in background
      ctx.waitUntil(
        (async () => {
          await new Promise((resolve) => setTimeout(resolve, 4000));
          await deleteMessage(token, chatId, tipId);
          await deleteMessage(token, chatId, userMsgId);
        })()
      );
    }

    return new Response('ok');
  }

  return new Response('ok');
}
