import { FullStateResponse, LeaderboardData, UserProfile, HatmData } from '../types';

const API_BASE = (import.meta as any).env?.VITE_API_URL || '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
    },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.detail || data.message || 'Тармоқ хатолиги юз берди');
  }
  return data as T;
}

export async function fetchAppState(
  userId: number,
  userName: string,
  username: string | null,
  hatmId?: number | null
): Promise<FullStateResponse> {
  const params = new URLSearchParams({
    user_id: String(userId),
    user_name: userName,
  });
  if (username) params.set('username', username);
  if (hatmId) params.set('hatm_id', String(hatmId));
  return request<FullStateResponse>(`/state?${params.toString()}`);
}

export async function bookSelectedJuzs(payload: {
  user_id: number;
  user_name: string;
  username?: string | null;
  hatm_id?: number;
  juz_numbers: number[];
}) {
  return request<{
    success: boolean;
    booked: number[];
    conflict: number[];
    message: string;
    hatm: HatmData;
    user: UserProfile;
  }>('/juz/book', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function completeBookedJuzs(payload: {
  user_id: number;
  hatm_id?: number;
  juz_numbers: number[];
}) {
  return request<{
    success: boolean;
    processed: number[];
    points_delta: number;
    message: string;
    hatm: HatmData;
    user: UserProfile;
  }>('/juz/complete', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function releaseBookedJuzs(payload: {
  user_id: number;
  hatm_id?: number;
  juz_numbers: number[];
}) {
  return request<{
    success: boolean;
    processed: number[];
    points_delta: number;
    message: string;
    hatm: HatmData;
    user: UserProfile;
  }>('/juz/release', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function fetchLeaderboard(limit = 10): Promise<LeaderboardData> {
  return request<LeaderboardData>(`/leaderboard?limit=${limit}`);
}

export async function fetchAdminOverview(adminId: number) {
  return request<{ admins: UserProfile[]; active_hatm: HatmData }>(
    `/admin/overview?admin_id=${adminId}`
  );
}

export async function triggerAdminDua(payload: {
  admin_id: number;
  hatm_id?: number;
  dua_message?: string;
  StartNewHatmAfterDua: boolean;
}) {
  return request<{
    success: boolean;
    message: string;
    finished_hatm: HatmData;
    active_hatm: HatmData;
  }>('/admin/dua', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function createNewHatmAdmin(payload: {
  admin_id: number;
  title?: string;
  dedication?: string;
  timer_hours?: number;
}) {
  return request<{
    success: boolean;
    message: string;
    active_hatm: HatmData;
  }>('/admin/new-hatm', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateHatmSettingsAdmin(payload: {
  admin_id: number;
  hatm_id?: number;
  title?: string;
  dedication?: string;
  timer_hours?: number;
}) {
  return request<{
    success: boolean;
    message: string;
    active_hatm: HatmData;
  }>('/admin/update-timer', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function forceFreeJuzAdmin(payload: {
  admin_id: number;
  hatm_id?: number;
  juz_number: number;
}) {
  return request<{
    success: boolean;
    message: string;
    active_hatm: HatmData;
  }>('/admin/force-free-juz', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function manageAdminsRequest(
  action: 'add' | 'remove',
  payload: {
    admin_id: number;
    target_user_id: number;
    target_user_name?: string;
  }
) {
  return request<{
    success: boolean;
    message: string;
    admins: UserProfile[];
  }>(`/admin/manage-admins?action=${action}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
