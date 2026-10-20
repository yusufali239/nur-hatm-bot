import { Env, HatmRow, JuzRow, UserRow, FullStateResponse, LeaderboardData } from './types';
import { syncChannelBoard, deleteChannelPost, sendGroupDua } from './channel';
import { sendMessage, deleteMessage, getBotToken } from './telegram';

export function getAdminIds(env: Env): number[] {
  const raw = env.ADMIN_IDS || '123456789';
  return raw
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n));
}

export function isAdminUser(env: Env, user: UserRow | null): boolean {
  if (!user) return false;
  if (user.is_admin === 1 || user.is_super_admin === 1) return true;
  const list = getAdminIds(env);
  return list.includes(user.id);
}

/**
 * Initializes database tables & seeds 2599-Хатм if not initialized yet
 */
export async function ensureInitialized(db: D1Database, env: Env): Promise<void> {
  const check = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='hatms'").first();
  if (!check) {
    // Run schema
    await db.exec(`
      CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL DEFAULT 'Муслим',
          username TEXT,
          avatar_url TEXT,
          total_hatm INTEGER NOT NULL DEFAULT 0,
          total_juz INTEGER NOT NULL DEFAULT 0,
          rating_points INTEGER NOT NULL DEFAULT 0,
          expired_count INTEGER NOT NULL DEFAULT 0,
          is_admin INTEGER NOT NULL DEFAULT 0,
          is_super_admin INTEGER NOT NULL DEFAULT 0,
          is_bot_blocked INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS hatms (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          number INTEGER NOT NULL,
          title TEXT NOT NULL DEFAULT 'Хатми Қуръон',
          dedication TEXT,
          status TEXT NOT NULL DEFAULT 'active',
          timer_hours INTEGER NOT NULL DEFAULT 72,
          channel_message_id INTEGER,
          dua_done INTEGER NOT NULL DEFAULT 0,
          dua_at TEXT,
          dua_by_admin_id INTEGER,
          dua_message TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          completed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS juzs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          hatm_id INTEGER NOT NULL REFERENCES hatms(id) ON DELETE CASCADE,
          number INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'free',
          user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          user_name TEXT,
          booked_at TEXT,
          expires_at TEXT,
          completed_at TEXT,
          warning_sent INTEGER NOT NULL DEFAULT 0,
          UNIQUE(hatm_id, number)
      );

      CREATE TABLE IF NOT EXISTS reminder_messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          message_id INTEGER NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS bot_state (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_juzs_hatm_id ON juzs(hatm_id);
      CREATE INDEX IF NOT EXISTS idx_juzs_status ON juzs(status);
      CREATE INDEX IF NOT EXISTS idx_juzs_user_id ON juzs(user_id);
      CREATE INDEX IF NOT EXISTS idx_users_rating ON users(rating_points DESC);
    `);
  }

  // Check if active hatm exists
  const hatmCount = await db.prepare('SELECT COUNT(*) as cnt FROM hatms').first<{ cnt: number }>();
  if (!hatmCount || hatmCount.cnt === 0) {
    const timerHours = parseInt(env.DEFAULT_TIMER_HOURS || '72', 10) || 72;
    await db.prepare(`
      INSERT INTO hatms (id, number, title, dedication, status, timer_hours, created_at)
      VALUES (1, 2599, '2599-Хатм', 'Барча мўмин-мусулмонлар ҳаққига бағишланади', 'active', ?, datetime('now'))
    `).bind(timerHours).run();

    const stmt = db.prepare('INSERT INTO juzs (hatm_id, number, status) VALUES (1, ?, "free")');
    const batch = [];
    for (let i = 1; i <= 30; i++) {
      batch.push(stmt.bind(i));
    }
    await db.batch(batch);
  }

  // Seed super-admins from config
  const adminIds = getAdminIds(env);
  for (const aid of adminIds) {
    await db.prepare(`
      INSERT INTO users (id, name, is_admin, is_super_admin)
      VALUES (?, 'Admin', 1, 1)
      ON CONFLICT(id) DO UPDATE SET is_admin = 1, is_super_admin = 1
    `).bind(aid).run();
  }
}

export async function getOrCreateUser(
  db: D1Database,
  env: Env,
  userId: number,
  name?: string,
  username?: string | null
): Promise<UserRow> {
  const existing = await db.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first<UserRow>();
  const adminIds = getAdminIds(env);
  const isSuper = adminIds.includes(userId) ? 1 : 0;
  const isAdmin = isSuper === 1 ? 1 : 0;

  if (existing) {
    if (name && name !== existing.name) {
      await db.prepare('UPDATE users SET name = ?, username = ?, updated_at = datetime("now") WHERE id = ?')
        .bind(name, username || existing.username, userId)
        .run();
      existing.name = name;
      existing.username = username || existing.username;
    }
    return existing;
  }

  const cleanName = name || `Қори #${userId}`;
  await db.prepare(`
    INSERT INTO users (id, name, username, is_admin, is_super_admin, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `).bind(userId, cleanName, username || null, isAdmin, isSuper).run();

  const created = await db.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first<UserRow>();
  return created!;
}

export async function getActiveHatm(
  db: D1Database,
  hatmId?: number
): Promise<{ hatm: HatmRow; juzs: JuzRow[] }> {
  let hatm: HatmRow | null = null;
  if (hatmId) {
    hatm = await db.prepare('SELECT * FROM hatms WHERE id = ?').bind(hatmId).first<HatmRow>();
  }
  if (!hatm) {
    hatm = await db.prepare('SELECT * FROM hatms WHERE status = "active" ORDER BY number DESC LIMIT 1').first<HatmRow>();
  }
  if (!hatm) {
    hatm = await db.prepare('SELECT * FROM hatms ORDER BY id DESC LIMIT 1').first<HatmRow>();
  }
  if (!hatm) {
    throw new Error('Фаол хатм топилмади.');
  }

  // Ensure all 30 juzs exist
  const juzsRes = await db.prepare('SELECT * FROM juzs WHERE hatm_id = ? ORDER BY number ASC').bind(hatm.id).all<JuzRow>();
  let juzs = juzsRes.results || [];
  if (juzs.length < 30) {
    const existingNums = new Set(juzs.map((j) => j.number));
    const batch = [];
    const insertStmt = db.prepare('INSERT INTO juzs (hatm_id, number, status) VALUES (?, ?, "free")');
    for (let i = 1; i <= 30; i++) {
      if (!existingNums.has(i)) {
        batch.push(insertStmt.bind(hatm.id, i));
      }
    }
    if (batch.length > 0) {
      await db.batch(batch);
      const refreshed = await db.prepare('SELECT * FROM juzs WHERE hatm_id = ? ORDER BY number ASC').bind(hatm.id).all<JuzRow>();
      juzs = refreshed.results || [];
    }
  }

  return { hatm, juzs };
}

export async function getLeaderboard(db: D1Database, limit: number = 10): Promise<LeaderboardData> {
  const topUsersRes = await db.prepare(`
    SELECT * FROM users
    WHERE total_juz > 0 OR rating_points > 0
    ORDER BY rating_points DESC, total_juz DESC
    LIMIT ?
  `).bind(limit).all<UserRow>();

  const topUsers = (topUsersRes.results || []).map((u, idx) => ({
    rank: idx + 1,
    id: u.id,
    name: u.name,
    username: u.username,
    avatar_url: u.avatar_url,
    total_hatm: u.total_hatm,
    total_juz: u.total_juz,
    rating_points: u.rating_points,
    badge: idx === 0 ? '👑 Ҳофиз' : idx < 3 ? '🌟 Мумтоз' : '📖 Қори',
  }));

  const stats = await db.prepare(`
    SELECT
      COUNT(DISTINCT user_id) as total_participants,
      COUNT(*) as total_completed_juzs
    FROM juzs
    WHERE status = 'done' AND user_id IS NOT NULL
  `).first<{ total_participants: number; total_completed_juzs: number }>();

  const completedHatms = await db.prepare(`
    SELECT COUNT(*) as count FROM hatms WHERE status = 'completed'
  `).first<{ count: number }>();

  return {
    top_users: topUsers,
    total_participants: stats?.total_participants || 0,
    total_completed_juzs: stats?.total_completed_juzs || 0,
    total_completed_hatms: Math.max(completedHatms?.count || 1, 1),
  };
}

export async function getFullState(
  db: D1Database,
  env: Env,
  userId: number = 777000,
  hatmId?: number
): Promise<FullStateResponse> {
  await ensureInitialized(db, env);
  const user = await getOrCreateUser(db, env, userId);
  const { hatm, juzs } = await getActiveHatm(db, hatmId);
  const leaderboard = await getLeaderboard(db, 10);

  const recentHatmsRes = await db.prepare(`
    SELECT * FROM hatms ORDER BY number DESC LIMIT 10
  `).all<HatmRow>();

  const recentHatms = await Promise.all(
    (recentHatmsRes.results || []).map(async (h) => {
      const counts = await db.prepare(`
        SELECT
          SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as done_count,
          SUM(CASE WHEN status = 'free' THEN 1 ELSE 0 END) as free_count,
          SUM(CASE WHEN status = 'booked' THEN 1 ELSE 0 END) as booked_count
        FROM juzs WHERE hatm_id = ?
      `).bind(h.id).first<{ done_count: number; free_count: number; booked_count: number }>();

      return {
        id: h.id,
        number: h.number,
        title: h.title,
        status: h.status,
        dua_done: h.dua_done === 1,
        dua_at: h.dua_at,
        dua_message: h.dua_message,
        done_count: counts?.done_count || 0,
        free_count: counts?.free_count || 0,
        booked_count: counts?.booked_count || 0,
      };
    })
  );

  const doneCount = juzs.filter((j) => j.status === 'done').length;
  const bookedCount = juzs.filter((j) => j.status === 'booked').length;
  const freeCount = juzs.filter((j) => j.status === 'free').length;

  return {
    bot_username: (env.BOT_USERNAME || 'nurHatmBot').trim().replace(/^@/, ''),
    hatm: {
      id: hatm.id,
      number: hatm.number,
      title: hatm.title,
      dedication: hatm.dedication,
      status: hatm.status,
      timer_hours: hatm.timer_hours,
      dua_done: hatm.dua_done === 1,
      dua_at: hatm.dua_at,
      dua_by_admin_id: hatm.dua_by_admin_id,
      dua_message: hatm.dua_message,
      created_at: hatm.created_at,
      completed_at: hatm.completed_at,
      free_count: freeCount,
      booked_count: bookedCount,
      done_count: doneCount,
      juzs: juzs.map((j) => ({
        id: j.id,
        hatm_id: j.hatm_id,
        number: j.number,
        status: j.status,
        user_id: j.user_id,
        user_name: j.user_name,
        booked_at: j.booked_at,
        expires_at: j.expires_at,
        completed_at: j.completed_at,
      })),
    },
    user: {
      id: user.id,
      name: user.name,
      username: user.username,
      total_hatm: user.total_hatm,
      total_juz: user.total_juz,
      rating_points: user.rating_points,
      expired_count: user.expired_count,
      is_admin: isAdminUser(env, user),
      is_super_admin: user.is_super_admin === 1,
    },
    leaderboard,
    recent_hatms: recentHatms,
  };
}

export async function bookMultipleJuzs(
  db: D1Database,
  env: Env,
  userId: number,
  userName: string,
  username: string | null | undefined,
  hatmId: number | undefined,
  juzNumbers: number[]
): Promise<{ booked: number[]; conflict: number[]; hatm: any; user: any; message: string }> {
  await ensureInitialized(db, env);
  const user = await getOrCreateUser(db, env, userId, userName, username);
  const { hatm } = await getActiveHatm(db, hatmId);

  const timerHours = hatm.timer_hours || 72;
  const now = new Date();
  const expires = new Date(now.getTime() + timerHours * 3600 * 1000);
  const nowIso = now.toISOString();
  const expiresIso = expires.toISOString();

  const booked: number[] = [];
  const conflict: number[] = [];

  for (const num of juzNumbers) {
    if (num < 1 || num > 30) continue;
    const res = await db.prepare(`
      UPDATE juzs
      SET status = 'booked',
          user_id = ?,
          user_name = ?,
          booked_at = ?,
          expires_at = ?,
          warning_sent = 0
      WHERE hatm_id = ? AND number = ? AND status = 'free'
    `).bind(user.id, user.name, nowIso, expiresIso, hatm.id, num).run();

    if (res.meta.changes > 0) {
      booked.push(num);
    } else {
      conflict.push(num);
    }
  }

  if (booked.length > 0) {
    await syncChannelBoard(env, hatm.id);
  }

  const fullState = await getFullState(db, env, user.id, hatm.id);
  let msg = `✓ ${booked.length} та пора банд қилинди (${timerHours} соат)`;
  if (conflict.length > 0) {
    msg += ` • ${conflict.length} таси бошқалар томонидан олинган`;
  }

  return {
    booked,
    conflict,
    hatm: fullState.hatm,
    user: fullState.user,
    message: msg,
  };
}

export async function completeUserJuzs(
  db: D1Database,
  env: Env,
  userId: number,
  juzNumbers: number[],
  hatmId?: number
): Promise<{ processed: number[]; pointsDelta: number; hatm: any; user: any; message: string }> {
  await ensureInitialized(db, env);
  const user = await getOrCreateUser(db, env, userId);
  const { hatm } = await getActiveHatm(db, hatmId);

  const completed: number[] = [];
  const nowIso = new Date().toISOString();

  for (const num of juzNumbers) {
    const res = await db.prepare(`
      UPDATE juzs
      SET status = 'done',
          completed_at = ?
      WHERE hatm_id = ? AND number = ? AND user_id = ? AND status = 'booked'
    `).bind(nowIso, hatm.id, num, user.id).run();

    if (res.meta.changes > 0) {
      completed.push(num);
    }
  }

  const ptsPerJuz = parseInt(env.POINTS_ON_COMPLETE || '10', 10) || 10;
  const pointsDelta = completed.length * ptsPerJuz;

  if (completed.length > 0) {
    await db.prepare(`
      UPDATE users
      SET total_juz = total_juz + ?,
          rating_points = rating_points + ?
      WHERE id = ?
    `).bind(completed.length, pointsDelta, user.id).run();

    // Auto-delete user's reminder messages from bot chat!
    await clearUserReminders(db, env, user.id);
    await syncChannelBoard(env, hatm.id);
  }

  const fullState = await getFullState(db, env, user.id, hatm.id);
  return {
    processed: completed,
    pointsDelta,
    hatm: fullState.hatm,
    user: fullState.user,
    message: `✨ ${completed.length} та пора қабул қилинди! (+${pointsDelta} балл)`,
  };
}

export async function uncompleteUserJuzs(
  db: D1Database,
  env: Env,
  userId: number,
  juzNumbers: number[],
  hatmId?: number
): Promise<{ processed: number[]; pointsDelta: number; hatm: any; user: any; message: string }> {
  await ensureInitialized(db, env);
  const user = await getOrCreateUser(db, env, userId);
  const { hatm } = await getActiveHatm(db, hatmId);

  const reverted: number[] = [];
  const timerHours = hatm.timer_hours || 72;
  const now = new Date();
  const expiresIso = new Date(now.getTime() + timerHours * 3600 * 1000).toISOString();

  for (const num of juzNumbers) {
    const res = await db.prepare(`
      UPDATE juzs
      SET status = 'booked',
          expires_at = ?,
          completed_at = NULL
      WHERE hatm_id = ? AND number = ? AND user_id = ? AND status = 'done'
    `).bind(expiresIso, hatm.id, num, user.id).run();

    if (res.meta.changes > 0) {
      reverted.push(num);
    }
  }

  const ptsPerJuz = parseInt(env.POINTS_ON_COMPLETE || '10', 10) || 10;
  const pointsDelta = -(reverted.length * ptsPerJuz);

  if (reverted.length > 0) {
    await db.prepare(`
      UPDATE users
      SET total_juz = MAX(0, total_juz - ?),
          rating_points = MAX(0, rating_points - ?)
      WHERE id = ?
    `).bind(reverted.length, reverted.length * ptsPerJuz, user.id).run();

    await syncChannelBoard(env, hatm.id);
  }

  const fullState = await getFullState(db, env, user.id, hatm.id);
  return {
    processed: reverted,
    pointsDelta,
    hatm: fullState.hatm,
    user: fullState.user,
    message: `${reverted.length} та пора ўқилмоқда ҳолатига қайтарилди`,
  };
}

export async function releaseUserJuzs(
  db: D1Database,
  env: Env,
  userId: number,
  juzNumbers: number[],
  hatmId?: number
): Promise<{ processed: number[]; pointsDelta: number; hatm: any; user: any; message: string }> {
  await ensureInitialized(db, env);
  const user = await getOrCreateUser(db, env, userId);
  const { hatm } = await getActiveHatm(db, hatmId);

  const released: number[] = [];
  for (const num of juzNumbers) {
    const res = await db.prepare(`
      UPDATE juzs
      SET status = 'free',
          user_id = NULL,
          user_name = NULL,
          booked_at = NULL,
          expires_at = NULL,
          warning_sent = 0
      WHERE hatm_id = ? AND number = ? AND user_id = ? AND status = 'booked'
    `).bind(hatm.id, num, user.id).run();

    if (res.meta.changes > 0) {
      released.push(num);
    }
  }

  if (released.length > 0) {
    await clearUserReminders(db, env, user.id);
    await syncChannelBoard(env, hatm.id);
  }

  const fullState = await getFullState(db, env, user.id, hatm.id);
  return {
    processed: released,
    pointsDelta: 0,
    hatm: fullState.hatm,
    user: fullState.user,
    message: `✓ ${released.length} та пора бўшатилди`,
  };
}

export async function adminSetJuz(
  db: D1Database,
  env: Env,
  hatmId: number,
  juzNumber: number,
  status: 'free' | 'booked' | 'done',
  readerName?: string
): Promise<any> {
  await ensureInitialized(db, env);
  const cleanName = readerName?.trim() || (status === 'free' ? null : 'Муслим');

  if (status === 'free') {
    await db.prepare(`
      UPDATE juzs
      SET status = 'free', user_id = NULL, user_name = NULL, booked_at = NULL, expires_at = NULL, completed_at = NULL, warning_sent = 0
      WHERE hatm_id = ? AND number = ?
    `).bind(hatmId, juzNumber).run();
  } else if (status === 'booked') {
    const now = new Date();
    const exp = new Date(now.getTime() + 72 * 3600 * 1000).toISOString();
    await db.prepare(`
      UPDATE juzs
      SET status = 'booked', user_name = ?, booked_at = ?, expires_at = ?, completed_at = NULL
      WHERE hatm_id = ? AND number = ?
    `).bind(cleanName, now.toISOString(), exp, hatmId, juzNumber).run();
  } else {
    await db.prepare(`
      UPDATE juzs
      SET status = 'done', user_name = ?, completed_at = datetime('now')
      WHERE hatm_id = ? AND number = ?
    `).bind(cleanName, hatmId, juzNumber).run();
  }

  await syncChannelBoard(env, hatmId);
  const fullState = await getFullState(db, env, 777000, hatmId);
  return fullState.hatm;
}

export async function adminUpdateHatm(
  db: D1Database,
  env: Env,
  hatmId: number,
  title?: string,
  dedication?: string,
  timerHours?: number,
  status?: string
): Promise<any> {
  await ensureInitialized(db, env);
  const current = await db.prepare('SELECT * FROM hatms WHERE id = ?').bind(hatmId).first<HatmRow>();
  if (!current) throw new Error('Хатм топилмади');

  const newTitle = title || current.title;
  const newDedication = dedication !== undefined ? dedication : current.dedication;
  const newTimer = timerHours || current.timer_hours;
  const newStatus = status || current.status;

  await db.prepare(`
    UPDATE hatms
    SET title = ?, dedication = ?, timer_hours = ?, status = ?
    WHERE id = ?
  `).bind(newTitle, newDedication, newTimer, newStatus, hatmId).run();

  await syncChannelBoard(env, hatmId);
  const fullState = await getFullState(db, env, 777000, hatmId);
  return fullState.hatm;
}

export async function adminDeleteHatm(
  db: D1Database,
  env: Env,
  hatmId: number
): Promise<{ title: string; activeHatm: any }> {
  await ensureInitialized(db, env);
  const hatm = await db.prepare('SELECT * FROM hatms WHERE id = ?').bind(hatmId).first<HatmRow>();
  if (!hatm) throw new Error('Хатм топилмади');

  await deleteChannelPost(env, hatm.channel_message_id);

  await db.prepare('DELETE FROM juzs WHERE hatm_id = ?').bind(hatmId).run();
  await db.prepare('DELETE FROM hatms WHERE id = ?').bind(hatmId).run();

  // If no active hatms remain, create a new one
  const remainCount = await db.prepare('SELECT COUNT(*) as cnt FROM hatms WHERE status = "active"').first<{ cnt: number }>();
  if (!remainCount || remainCount.cnt === 0) {
    const maxNum = (await db.prepare('SELECT MAX(number) as mx FROM hatms').first<{ mx: number }>())?.mx || 2598;
    const nextNum = Math.max(maxNum + 1, 2599);
    await db.prepare(`
      INSERT INTO hatms (number, title, dedication, status, timer_hours, created_at)
      VALUES (?, ?, 'Барча мўмин-мусулмонлар ҳаққига бағишланади', 'active', 72, datetime('now'))
    `).bind(nextNum, `${nextNum}-Хатм`).run();

    const newHatm = await db.prepare('SELECT * FROM hatms ORDER BY id DESC LIMIT 1').first<HatmRow>();
    if (newHatm) {
      const batch = [];
      const insStmt = db.prepare('INSERT INTO juzs (hatm_id, number, status) VALUES (?, ?, "free")');
      for (let i = 1; i <= 30; i++) {
        batch.push(insStmt.bind(newHatm.id, i));
      }
      await db.batch(batch);
      await syncChannelBoard(env, newHatm.id);
    }
  }

  const fullState = await getFullState(db, env, 777000);
  return {
    title: hatm.title,
    activeHatm: fullState.hatm,
  };
}

export async function adminPerformDua(
  db: D1Database,
  env: Env,
  adminId: number,
  hatmId?: number,
  duaMessage?: string,
  startNewHatm: boolean = true
): Promise<{ finishedHatm: any; activeHatm: any; message: string }> {
  await ensureInitialized(db, env);
  const { hatm } = await getActiveHatm(db, hatmId);

  const defaultDua =
    '🤲 Аллоҳим! Ушбу ўқилган Қуръони Карим оятларининг нури ва савобини ' +
    'Пайғамбаримиз Муҳаммад Мустафо ﷺ руҳи покларига, барча ўтган мўмин-мусулмонлар ' +
    'руҳига ҳамда хатмда қатнашган қори ва қорияларимизнинг икки дунё саодатига ' +
    'васила қилгин! Омин!';

  const finalDua = (duaMessage || '').trim() || defaultDua;
  const nowIso = new Date().toISOString();

  await db.prepare(`
    UPDATE hatms
    SET dua_done = 1,
        dua_at = ?,
        dua_by_admin_id = ?,
        dua_message = ?,
        status = 'completed',
        completed_at = ?
    WHERE id = ?
  `).bind(nowIso, adminId, finalDua, nowIso, hatm.id).run();

  let nextHatmRow: HatmRow | null = null;
  if (startNewHatm) {
    const nextNum = Math.max(hatm.number + 1, 2599);
    await db.prepare(`
      INSERT INTO hatms (number, title, dedication, status, timer_hours, created_at)
      VALUES (?, ?, 'Барча мўмин-мусулмонлар ҳаққига бағишланади', 'active', ?, datetime('now'))
    `).bind(nextNum, `${nextNum}-Хатм`, hatm.timer_hours).run();

    nextHatmRow = await db.prepare('SELECT * FROM hatms ORDER BY id DESC LIMIT 1').first<HatmRow>();
    if (nextHatmRow) {
      const batch = [];
      const insStmt = db.prepare('INSERT INTO juzs (hatm_id, number, status) VALUES (?, ?, "free")');
      for (let i = 1; i <= 30; i++) {
        batch.push(insStmt.bind(nextHatmRow.id, i));
      }
      await db.batch(batch);
    }
  }

  // Refresh finished hatm & send completion Dua directly to @hatmiquaan
  const finished = await db.prepare('SELECT * FROM hatms WHERE id = ?').bind(hatm.id).first<HatmRow>();
  await sendGroupDua(env, finished!, nextHatmRow);
  await syncChannelBoard(env, hatm.id);
  if (nextHatmRow) {
    await syncChannelBoard(env, nextHatmRow.id);
  }

  const activeState = await getFullState(db, env, adminId, nextHatmRow?.id || hatm.id);
  const finishedState = await getFullState(db, env, adminId, hatm.id);

  return {
    finishedHatm: finishedState.hatm,
    activeHatm: activeState.hatm,
    message: `🤲 ${hatm.title} Дуоси гуруҳга юборилди ва янги хатм очилди!`,
  };
}

export async function adminCreateNewHatm(
  db: D1Database,
  env: Env,
  timerHours: number = 72
): Promise<any> {
  await ensureInitialized(db, env);
  const maxNum = (await db.prepare('SELECT MAX(number) as mx FROM hatms').first<{ mx: number }>())?.mx || 2598;
  const nextNum = Math.max(maxNum + 1, 2599);

  await db.prepare(`
    INSERT INTO hatms (number, title, dedication, status, timer_hours, created_at)
    VALUES (?, ?, 'Барча мўмин-мусулмонлар ҳаққига бағишланади', 'active', ?, datetime('now'))
  `).bind(nextNum, `${nextNum}-Хатм`, timerHours).run();

  const created = await db.prepare('SELECT * FROM hatms ORDER BY id DESC LIMIT 1').first<HatmRow>();
  if (created) {
    const batch = [];
    const ins = db.prepare('INSERT INTO juzs (hatm_id, number, status) VALUES (?, ?, "free")');
    for (let i = 1; i <= 30; i++) {
      batch.push(ins.bind(created.id, i));
    }
    await db.batch(batch);
    await syncChannelBoard(env, created.id);
  }

  const fullState = await getFullState(db, env, 777000, created?.id);
  return fullState.hatm;
}

export async function adminResetHatm(
  db: D1Database,
  env: Env,
  hatmId: number
): Promise<any> {
  await ensureInitialized(db, env);
  await db.prepare(`
    UPDATE juzs
    SET status = 'free', user_id = NULL, user_name = NULL, booked_at = NULL, expires_at = NULL, completed_at = NULL, warning_sent = 0
    WHERE hatm_id = ?
  `).bind(hatmId).run();

  await syncChannelBoard(env, hatmId);
  const fullState = await getFullState(db, env, 777000, hatmId);
  return fullState.hatm;
}

export async function clearUserReminders(
  db: D1Database,
  env: Env,
  userId: number
): Promise<void> {
  const token = getBotToken(env);
  if (!token) return;

  try {
    const res = await db.prepare('SELECT message_id FROM reminder_messages WHERE user_id = ?').bind(userId).all<{ message_id: number }>();
    const ids = (res.results || []).map((r) => r.message_id);
    for (const mid of ids) {
      await deleteMessage(token, userId, mid);
    }
    await db.prepare('DELETE FROM reminder_messages WHERE user_id = ?').bind(userId).run();
  } catch (err: any) {
    console.debug(`clearUserReminders error for ${userId}:`, err);
  }
}

/**
 * Sweeper invoked by Cloudflare Cron Trigger every minute (* * * * *)
 * Frees expired booked Juzs, penalizes points, and sends 1h warning reminders.
 */
export async function sweepExpiredJuzs(db: D1Database, env: Env): Promise<number> {
  await ensureInitialized(db, env);
  const token = getBotToken(env);
  const penalty = parseInt(env.POINTS_ON_EXPIRE_PENALTY || '5', 10) || 5;

  // 1. Expired booked Juzs
  const expiredRes = await db.prepare(`
    SELECT * FROM juzs
    WHERE status = 'booked' AND expires_at IS NOT NULL AND expires_at <= datetime('now')
  `).all<JuzRow>();

  const expired = expiredRes.results || [];
  if (expired.length === 0) {
    // Check 1h warnings
    await checkWarnings(db, env, token);
    return 0;
  }

  const affectedHatms = new Set<number>();
  const expiredByUser = new Map<number, number[]>();

  for (const j of expired) {
    affectedHatms.add(j.hatm_id);
    await db.prepare(`
      UPDATE juzs
      SET status = 'free', user_id = NULL, user_name = NULL, booked_at = NULL, expires_at = NULL, warning_sent = 0
      WHERE id = ?
    `).bind(j.id).run();

    if (j.user_id) {
      const list = expiredByUser.get(j.user_id) || [];
      list.push(j.number);
      expiredByUser.set(j.user_id, list);
    }
  }

  for (const [uid, nums] of expiredByUser.entries()) {
    const pen = nums.length * penalty;
    await db.prepare(`
      UPDATE users
      SET rating_points = MAX(0, rating_points - ?),
          expired_count = expired_count + ?
      WHERE id = ?
    `).bind(pen, nums.length, uid).run();

    await clearUserReminders(db, env, uid);

    if (token) {
      const numsStr = nums.join(', ');
      await sendMessage(token, uid, `⌛️ <b>${numsStr}-пора</b> муддати тугади • −${pen} балл`);
    }
  }

  for (const hid of affectedHatms) {
    await syncChannelBoard(env, hid);
  }

  // Also check warnings
  await checkWarnings(db, env, token);
  return expired.length;
}

async function checkWarnings(db: D1Database, env: Env, token: string): Promise<void> {
  if (!token) return;

  // Juzs expiring within 1 hour where warning_sent = 0
  const warnRes = await db.prepare(`
    SELECT * FROM juzs
    WHERE status = 'booked'
      AND warning_sent = 0
      AND user_id IS NOT NULL
      AND expires_at IS NOT NULL
      AND expires_at > datetime('now')
      AND expires_at <= datetime('now', '+1 hour')
  `).all<JuzRow>();

  const toWarn = warnRes.results || [];
  for (const j of toWarn) {
    await db.prepare('UPDATE juzs SET warning_sent = 1 WHERE id = ?').bind(j.id).run();
    if (j.user_id) {
      const sendRes = await sendMessage(token, j.user_id, `⏳ <b>${j.number}-пора:</b> 1 соат вақт қолди`);
      if (sendRes && sendRes.ok && sendRes.result?.message_id) {
        await db.prepare('INSERT INTO reminder_messages (user_id, message_id) VALUES (?, ?)')
          .bind(j.user_id, sendRes.result.message_id)
          .run();
      }
    }
  }
}
