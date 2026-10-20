-- =========================================================
-- 🌙 NUR HATM - CLOUDFLARE D1 (SQLite) SCHEMA & MIGRATION
-- =========================================================

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY, -- Telegram User ID
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
    status TEXT NOT NULL DEFAULT 'active', -- 'active' | 'completed'
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
    number INTEGER NOT NULL, -- 1..30
    status TEXT NOT NULL DEFAULT 'free', -- 'free' | 'booked' | 'done'
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

-- Fast lookup indices
CREATE INDEX IF NOT EXISTS idx_juzs_hatm_id ON juzs(hatm_id);
CREATE INDEX IF NOT EXISTS idx_juzs_status ON juzs(status);
CREATE INDEX IF NOT EXISTS idx_juzs_user_id ON juzs(user_id);
CREATE INDEX IF NOT EXISTS idx_users_rating ON users(rating_points DESC);
CREATE INDEX IF NOT EXISTS idx_reminder_user_id ON reminder_messages(user_id);

-- =========================================================
-- INITIAL SEED: 2599-ХАТМ (30 FREE JUZS)
-- =========================================================

INSERT INTO hatms (id, number, title, dedication, status, timer_hours, created_at)
VALUES (1, 2599, '2599-Хатм', 'Барча мўмин-мусулмонлар ҳаққига бағишланади', 'active', 72, datetime('now'))
ON CONFLICT(id) DO NOTHING;

INSERT INTO juzs (hatm_id, number, status) VALUES
(1, 1, 'free'), (1, 2, 'free'), (1, 3, 'free'), (1, 4, 'free'), (1, 5, 'free'),
(1, 6, 'free'), (1, 7, 'free'), (1, 8, 'free'), (1, 9, 'free'), (1, 10, 'free'),
(1, 11, 'free'), (1, 12, 'free'), (1, 13, 'free'), (1, 14, 'free'), (1, 15, 'free'),
(1, 16, 'free'), (1, 17, 'free'), (1, 18, 'free'), (1, 19, 'free'), (1, 20, 'free'),
(1, 21, 'free'), (1, 22, 'free'), (1, 23, 'free'), (1, 24, 'free'), (1, 25, 'free'),
(1, 26, 'free'), (1, 27, 'free'), (1, 28, 'free'), (1, 29, 'free'), (1, 30, 'free')
ON CONFLICT(hatm_id, number) DO NOTHING;
