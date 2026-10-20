export interface Env {
  DB: D1Database;
  ASSETS?: Fetcher;
  BOT_TOKEN?: string;
  BOT_USERNAME?: string;
  CHANNEL_ID?: string;
  ADMIN_IDS?: string;
  DEFAULT_TIMER_HOURS?: string;
  POINTS_ON_COMPLETE?: string;
  POINTS_ON_EXPIRE_PENALTY?: string;
  WEBAPP_URL?: string;
}

export interface UserRow {
  id: number;
  name: string;
  username: string | null;
  avatar_url: string | null;
  total_hatm: number;
  total_juz: number;
  rating_points: number;
  expired_count: number;
  is_admin: number;
  is_super_admin: number;
  is_bot_blocked: number;
  created_at: string;
  updated_at: string;
}

export interface HatmRow {
  id: number;
  number: number;
  title: string;
  dedication: string | null;
  status: 'active' | 'completed';
  timer_hours: number;
  channel_message_id: number | null;
  dua_done: number;
  dua_at: string | null;
  dua_by_admin_id: number | null;
  dua_message: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface JuzRow {
  id: number;
  hatm_id: number;
  number: number;
  status: 'free' | 'booked' | 'done';
  user_id: number | null;
  user_name: string | null;
  booked_at: string | null;
  expires_at: string | null;
  completed_at: string | null;
  warning_sent: number;
}

export interface LeaderboardEntry {
  rank: number;
  id: number;
  name: string;
  username: string | null;
  avatar_url: string | null;
  total_hatm: number;
  total_juz: number;
  rating_points: number;
  badge: string;
}

export interface LeaderboardData {
  top_users: LeaderboardEntry[];
  total_participants: number;
  total_completed_juzs: number;
  total_completed_hatms: number;
}

export interface FullStateResponse {
  bot_username: string | null;
  hatm: {
    id: number;
    number: number;
    title: string;
    dedication: string | null;
    status: string;
    timer_hours: number;
    dua_done: boolean;
    dua_at: string | null;
    dua_by_admin_id: number | null;
    dua_message: string | null;
    created_at: string;
    completed_at: string | null;
    free_count: number;
    booked_count: number;
    done_count: number;
    juzs: Array<{
      id: number;
      hatm_id: number;
      number: number;
      status: 'free' | 'booked' | 'done';
      user_id: number | null;
      user_name: string | null;
      booked_at: string | null;
      expires_at: string | null;
      completed_at: string | null;
    }>;
  };
  user: {
    id: number;
    name: string;
    username: string | null;
    total_hatm: number;
    total_juz: number;
    rating_points: number;
    expired_count: number;
    is_admin: boolean;
    is_super_admin: boolean;
  };
  leaderboard: LeaderboardData;
  recent_hatms: Array<{
    id: number;
    number: number;
    title: string;
    status: string;
    dua_done: boolean;
    dua_at: string | null;
    dua_message: string | null;
    done_count: number;
    free_count: number;
    booked_count: number;
  }>;
}
