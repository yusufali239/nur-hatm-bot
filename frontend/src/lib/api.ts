import { FullStateResponse, LeaderboardData, UserProfile, HatmData } from '../types';

const getApiBase = (): string => {
  const envUrl = (import.meta as any).env?.VITE_API_URL;
  if (envUrl && typeof envUrl === 'string' && envUrl.trim()) {
    return envUrl.trim().replace(/\/+$/, '');
  }
  return '/api';
};

const API_BASE = getApiBase();

async function request<T>(path: string, options?: RequestInit, retries = 1): Promise<T> {
  const url = `${API_BASE}${path}`;
  try {
    const res = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
      },
      ...options,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.detail || data.message || 'Сервер хатолик қайтарди');
    }
    return data as T;
  } catch (err: any) {
    if (retries > 0) {
      // Retry once after brief delay (helps when Render is waking up)
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return request<T>(path, options, retries - 1);
    }
    const msg = String(err?.message || '');
    if (msg.toLowerCase().includes('failed to fetch') || msg.toLowerCase().includes('networkerror')) {
      throw new Error('Сервер ишга тушмоқда ёки тармоқ уланиши йўқ. Илтимос, бир оз кутиб қайта янгиланг.');
    }
    throw err;
  }
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

export async function uncompleteBookedJuzs(payload: {
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
  }>('/juz/uncomplete', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function resetHatmAdmin(payload: {
  admin_id: number;
  hatm_id?: number;
}) {
  return request<{
    success: boolean;
    message: string;
    active_hatm: HatmData;
  }>('/admin/reset-hatm', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function adminSetJuz(payload: {
  admin_id: number;
  hatm_id?: number;
  juz_number: number;
  juz_status: 'free' | 'booked' | 'done';
  reader_name?: string;
}) {
  return request<{
    success: boolean;
    message: string;
    active_hatm: HatmData;
  }>('/admin/set-juz', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function adminDeleteHatm(payload: {
  admin_id: number;
  hatm_id: number;
}) {
  return request<{
    success: boolean;
    message: string;
    active_hatm: HatmData;
  }>('/admin/delete-hatm', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function adminUpdateHatm(payload: {
  admin_id: number;
  hatm_id?: number;
  title?: string;
  dedication?: string;
  timer_hours?: number;
  hatm_status?: 'active' | 'completed';
}) {
  return request<{
    success: boolean;
    message: string;
    active_hatm: HatmData;
  }>('/admin/update-hatm', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

