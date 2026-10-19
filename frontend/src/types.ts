export type JuzStatus = 'free' | 'booked' | 'done';

export interface JuzItem {
  id: number;
  hatm_id: number;
  number: number; // 1..30
  status: JuzStatus;
  user_id: number | null;
  user_name: string | null;
  booked_at: string | null;
  expires_at: string | null;
  completed_at: string | null;
}

export interface HatmData {
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
  juzs: JuzItem[];
}

export interface UserProfile {
  id: number;
  name: string;
  username: string | null;
  total_hatm: number;
  total_juz: number;
  rating_points: number;
  expired_count: number;
  is_admin: boolean;
  is_super_admin: boolean;
}

export interface LeaderboardEntry {
  rank: number;
  id: number;
  name: string;
  username: string | null;
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

export interface RecentHatmSummary {
  id: number;
  number: number;
  title: string;
  status: string;
  dua_done: boolean;
  dua_at: string | null;
  dua_message: string | null;
  done_count?: number;
  free_count?: number;
  booked_count?: number;
}

export interface FullStateResponse {
  bot_username?: string | null;
  hatm: HatmData;
  user: UserProfile;
  leaderboard: LeaderboardData;
  recent_hatms: RecentHatmSummary[];
}
