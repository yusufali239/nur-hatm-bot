import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Env } from './types';
import {
  ensureInitialized,
  getFullState,
  bookMultipleJuzs,
  completeUserJuzs,
  uncompleteUserJuzs,
  releaseUserJuzs,
  getLeaderboard,
  adminSetJuz,
  adminUpdateHatm,
  adminDeleteHatm,
  adminPerformDua,
  adminCreateNewHatm,
  adminResetHatm,
  adminResetUserStats,
  adminResetAllLeaderboard,
  sweepExpiredJuzs,
  getOrCreateUser,
  getActiveHatm,
} from './db';
import { setWebhook, getMe, getBotToken } from './telegram';
import { handleTelegramWebhook } from './bot';

const app = new Hono<{ Bindings: Env }>();

// Enable CORS for all origins
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

// ==========================================
// 1. HEALTH & STATE
// ==========================================

app.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    project: 'NUR HATM CLOUDFLARE',
    timer_hours: parseInt(c.env.DEFAULT_TIMER_HOURS || '72', 10) || 72,
    points_on_complete: parseInt(c.env.POINTS_ON_COMPLETE || '10', 10) || 10,
    points_on_expire_penalty: parseInt(c.env.POINTS_ON_EXPIRE_PENALTY || '5', 10) || 5,
  });
});

app.get('/api/state', async (c) => {
  const userId = parseInt(c.req.query('user_id') || '777000', 10);
  const hatmId = c.req.query('hatm_id') ? parseInt(c.req.query('hatm_id')!, 10) : undefined;
  const state = await getFullState(c.env.DB, c.env, userId, hatmId);
  return c.json(state);
});

// ==========================================
// 2. JUZ ACTIONS
// ==========================================

app.post('/api/juz/book', async (c) => {
  const body = await c.req.json<any>();
  const res = await bookMultipleJuzs(
    c.env.DB,
    c.env,
    body.user_id,
    body.user_name || 'Муслим',
    body.username,
    body.hatm_id,
    body.juz_numbers || []
  );
  return c.json({
    success: true,
    booked: res.booked,
    conflict: res.conflict,
    message: res.message,
    hatm: res.hatm,
    user: res.user,
  });
});
app.post('/api/book', (c) => c.redirect('/api/juz/book', 307));

app.post('/api/juz/complete', async (c) => {
  const body = await c.req.json<any>();
  const res = await completeUserJuzs(
    c.env.DB,
    c.env,
    body.user_id,
    body.juz_numbers || [],
    body.hatm_id
  );
  return c.json({
    success: true,
    processed: res.processed,
    points_delta: res.pointsDelta,
    message: res.message,
    hatm: res.hatm,
    user: res.user,
  });
});
app.post('/api/complete', (c) => c.redirect('/api/juz/complete', 307));

app.post('/api/juz/uncomplete', async (c) => {
  const body = await c.req.json<any>();
  const res = await uncompleteUserJuzs(
    c.env.DB,
    c.env,
    body.user_id,
    body.juz_numbers || [],
    body.hatm_id
  );
  return c.json({
    success: true,
    processed: res.processed,
    points_delta: res.pointsDelta,
    message: res.message,
    hatm: res.hatm,
    user: res.user,
  });
});
app.post('/api/uncomplete', (c) => c.redirect('/api/juz/uncomplete', 307));

app.post('/api/juz/release', async (c) => {
  const body = await c.req.json<any>();
  const res = await releaseUserJuzs(
    c.env.DB,
    c.env,
    body.user_id,
    body.juz_numbers || [],
    body.hatm_id
  );
  return c.json({
    success: true,
    processed: res.processed,
    points_delta: res.pointsDelta,
    message: res.message,
    hatm: res.hatm,
    user: res.user,
  });
});
app.post('/api/release', (c) => c.redirect('/api/juz/release', 307));

app.get('/api/leaderboard', async (c) => {
  const limit = parseInt(c.req.query('limit') || '10', 10);
  const lb = await getLeaderboard(c.env.DB, limit);
  return c.json(lb);
});

// ==========================================
// 3. ADMIN ENDPOINTS
// ==========================================

app.get('/api/admin/overview', async (c) => {
  await ensureInitialized(c.env.DB, c.env);
  const adminsRes = await c.env.DB.prepare('SELECT * FROM users WHERE (is_admin = 1 OR is_super_admin = 1) AND id NOT IN (123456789, 1234567)').all<any>();
  const admins = (adminsRes.results || []).map((u) => ({
    id: u.id,
    name: u.name,
    username: u.username,
    total_hatm: u.total_hatm,
    total_juz: u.total_juz,
    rating_points: u.rating_points,
    expired_count: u.expired_count,
    is_admin: true,
    is_super_admin: u.is_super_admin === 1,
  }));
  const fullState = await getFullState(c.env.DB, c.env, 777000);
  return c.json({ admins, active_hatm: fullState.hatm });
});

app.post('/api/admin/dua', async (c) => {
  const body = await c.req.json<any>();
  const res = await adminPerformDua(
    c.env.DB,
    c.env,
    body.admin_id,
    body.hatm_id,
    body.dua_message,
    body.StartNewHatmAfterDua ?? true
  );
  return c.json({
    success: true,
    message: res.message,
    finished_hatm: res.finishedHatm,
    active_hatm: res.activeHatm,
  });
});

app.post('/api/admin/new-hatm', async (c) => {
  const body = await c.req.json<any>();
  const activeHatm = await adminCreateNewHatm(c.env.DB, c.env, body.timer_hours || 72);
  return c.json({
    success: true,
    message: `✓ Янги ${activeHatm.title} очилди!`,
    active_hatm: activeHatm,
  });
});

app.post('/api/admin/update-timer', async (c) => {
  const body = await c.req.json<any>();
  const activeHatm = await adminUpdateHatm(
    c.env.DB,
    c.env,
    body.hatm_id,
    body.title,
    body.dedication,
    body.timer_hours
  );
  return c.json({
    success: true,
    message: `Муддат янгиланди: ${body.timer_hours} соат`,
    active_hatm: activeHatm,
  });
});

app.post('/api/admin/force-free-juz', async (c) => {
  const body = await c.req.json<any>();
  const activeHatm = await adminSetJuz(c.env.DB, c.env, body.hatm_id, body.juz_number, 'free');
  return c.json({
    success: true,
    message: `✓ ${body.juz_number}-пора мажбурий бўшатилди`,
    active_hatm: activeHatm,
  });
});

app.post('/api/admin/manage-admins', async (c) => {
  const action = c.req.query('action') || 'add';
  const body = await c.req.json<any>();
  const targetId = body.target_user_id;

  if (action === 'add') {
    const targetName = body.target_user_name || `Admin #${targetId}`;
    await c.env.DB.prepare(`
      INSERT INTO users (id, name, is_admin, is_super_admin) VALUES (?, ?, 1, 0)
      ON CONFLICT(id) DO UPDATE SET is_admin = 1
    `).bind(targetId, targetName).run();
  } else {
    await c.env.DB.prepare('UPDATE users SET is_admin = 0 WHERE id = ?').bind(targetId).run();
  }

  const adminsRes = await c.env.DB.prepare('SELECT * FROM users WHERE (is_admin = 1 OR is_super_admin = 1) AND id NOT IN (123456789, 1234567)').all<any>();
  const admins = (adminsRes.results || []).map((u) => ({
    id: u.id,
    name: u.name,
    username: u.username,
    total_hatm: u.total_hatm,
    total_juz: u.total_juz,
    rating_points: u.rating_points,
    expired_count: u.expired_count,
    is_admin: true,
    is_super_admin: u.is_super_admin === 1,
  }));

  return c.json({
    success: true,
    message: action === 'add' ? 'Админ қўшилди' : 'Админ ўчирилди',
    admins,
  });
});

app.post('/api/admin/reset-hatm', async (c) => {
  const body = await c.req.json<any>();
  const activeHatm = await adminResetHatm(c.env.DB, c.env, body.hatm_id);
  return c.json({
    success: true,
    message: `🧹 Барча 30 та пора тозаланди`,
    active_hatm: activeHatm,
  });
});

app.post('/api/admin/set-juz', async (c) => {
  const body = await c.req.json<any>();
  const activeHatm = await adminSetJuz(
    c.env.DB,
    c.env,
    body.hatm_id,
    body.juz_number,
    body.juz_status,
    body.reader_name
  );
  return c.json({
    success: true,
    message: `✓ ${body.juz_number}-пора янгиланди`,
    active_hatm: activeHatm,
  });
});

app.post('/api/admin/delete-hatm', async (c) => {
  const body = await c.req.json<any>();
  const res = await adminDeleteHatm(c.env.DB, c.env, body.hatm_id, body.admin_id);
  return c.json({
    success: true,
    message: `🗑 «${res.title}» ўчирилди`,
    active_hatm: res.activeHatm,
    full_state: res.fullState,
  });
});

app.post('/api/admin/update-hatm', async (c) => {
  const body = await c.req.json<any>();
  const activeHatm = await adminUpdateHatm(
    c.env.DB,
    c.env,
    body.hatm_id,
    body.title,
    body.dedication,
    body.timer_hours,
    body.hatm_status
  );
  return c.json({
    success: true,
    message: `⚙️ Сақланди`,
    active_hatm: activeHatm,
  });
});

app.post('/api/admin/reset-user-stats', async (c) => {
  const body = await c.req.json<any>();
  const res = await adminResetUserStats(
    c.env.DB,
    c.env,
    body.admin_id,
    body.target_user_id,
    Boolean(body.delete_user)
  );
  return c.json({
    success: true,
    message: res.message,
    full_state: res.fullState,
  });
});

app.post('/api/admin/reset-all-ratings', async (c) => {
  const body = await c.req.json<any>();
  const res = await adminResetAllLeaderboard(c.env.DB, c.env, body.admin_id);
  return c.json({
    success: true,
    message: res.message,
    full_state: res.fullState,
  });
});

// ==========================================
// 4. TELEGRAM WEBHOOK & SET-WEBHOOK
// ==========================================

app.post('/webhook', async (c) => {
  return handleTelegramWebhook(c.req.raw, c.env, c.executionCtx);
});

app.all('/api/set-webhook', async (c) => {
  const token = getBotToken(c.env);
  if (!token) {
    return c.json({ ok: false, error: 'BOT_TOKEN is missing in env' }, 400);
  }
  const workerUrl = new URL(c.req.url).origin;
  const webhookUrl = `${workerUrl}/webhook`;
  const res = await setWebhook(token, webhookUrl);
  const me = await getMe(token);
  return c.json({
    webhook_url: webhookUrl,
    telegram_response: res,
    bot: me?.result || null,
  });
});

// ==========================================
// 5. STATIC ASSETS FALLBACK (React Mini App)
// ==========================================

app.all('*', async (c) => {
  if (c.env.ASSETS) {
    return c.env.ASSETS.fetch(c.req.raw);
  }
  return c.text('NUR HATM Worker is running. Frontend static assets not bound.', 200);
});

// Export Cloudflare Worker definition with Cron Trigger handler
export default {
  fetch: app.fetch,

  /**
   * Cloudflare Cron Trigger (Runs every minute: * * * * *)
   * Never sleeps! Automatically checks expired Juzs, penalizes rating,
   * sends warning reminders and updates channel post in real time.
   */
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      (async () => {
        try {
          const freed = await sweepExpiredJuzs(env.DB, env);
          if (freed > 0) {
            console.log(`Cron sweeper: freed ${freed} expired juzs`);
          }
        } catch (err) {
          console.error('Cron sweeper error:', err);
        }
      })()
    );
  },
};
