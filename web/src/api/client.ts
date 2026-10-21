import type {
  AuthResponse,
  Comment,
  CreateSessionInput,
  LeaderboardEntry,
  Page,
  Stats,
  User,
  UserProfile,
  Visibility,
  Category,
  WorkSession,
} from '@shared/types';
import { localDateString } from '../lib/format';
import { safeGet, safeRemove, safeSet } from '../lib/storage';

export const TOKEN_KEY = 'latent.token';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export const getToken = (): string | null => safeGet(TOKEN_KEY);
export const setToken = (t: string): void => safeSet(TOKEN_KEY, t);

export function clearToken(): void {
  safeRemove(TOKEN_KEY);
  // Drop any cached API responses so the next user never sees them offline.
  try {
    navigator.serviceWorker?.controller?.postMessage({ type: 'clear-api-cache' });
  } catch {
    /* ignore */
  }
}

let unauthorizedHandler: (() => void) | null = null;
/** AuthProvider registers this; the route guard then redirects to /login. */
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  unauthorizedHandler = fn;
}

function handleUnauthorized(): void {
  clearToken();
  if (unauthorizedHandler) unauthorizedHandler();
  else if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
    window.location.assign('/login');
  }
}

function errorMessage(data: unknown, fallback: string): string {
  if (data && typeof data === 'object' && 'error' in data && typeof (data as { error: unknown }).error === 'string') {
    return (data as { error: string }).error;
  }
  return fallback;
}

interface ReqOpts {
  /** Auth endpoints (login/signup): a 401 is a normal error, not a session expiry. */
  noRedirect?: boolean;
}

async function request<T>(method: string, path: string, body?: unknown, opts: ReqOpts = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError('Network error. Check your connection and try again.', 0);
  }

  let data: unknown = undefined;
  if (res.status !== 204) {
    const text = await res.text().catch(() => '');
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = undefined;
      }
    }
  }

  if (!res.ok) {
    if (res.status === 401 && !opts.noRedirect) handleUnauthorized();
    throw new ApiError(errorMessage(data, res.statusText || `Request failed (${res.status})`), res.status);
  }
  return data as T;
}

const q = encodeURIComponent;
/** The user's local date; the server defaults to UTC, which breaks streaks/weeks across time zones. */
const todayQs = (prefix: '?' | '&' = '?') => `${prefix}today=${q(localDateString())}`;
const cursorQs = (cursor?: string | null) => (cursor ? `?cursor=${q(cursor)}` : '');

export interface SessionPatch {
  title?: string;
  description?: string;
  category?: Category;
  visibility?: Visibility;
}

export interface ProfilePatch {
  displayName?: string;
  bio?: string;
  weeklyGoalMin?: number;
}

function extFor(mime: string): string {
  if (mime.includes('mp4')) return 'mp4';
  if (mime.includes('webm')) return 'webm';
  return 'bin';
}

/** Multipart upload with progress (fetch cannot report upload progress). */
export function uploadSession(
  meta: CreateSessionInput,
  video: Blob,
  thumbnail: Blob,
  onProgress?: (fraction: number) => void,
): Promise<WorkSession> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('meta', JSON.stringify(meta));
    const videoType = video.type || 'video/webm';
    form.append('video', new File([video], `session.${extFor(videoType)}`, { type: videoType }));
    form.append('thumbnail', new File([thumbnail], 'thumbnail.jpg', { type: thumbnail.type || 'image/jpeg' }));

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/sessions');
    const token = getToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onerror = () => reject(new ApiError('Network error while uploading. Your session is still saved on this device.', 0));
    xhr.ontimeout = () => reject(new ApiError('Upload timed out. Your session is still saved on this device.', 0));
    xhr.onload = () => {
      let data: unknown;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        data = undefined;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(1);
        resolve(data as WorkSession);
      } else {
        if (xhr.status === 401) handleUnauthorized();
        reject(new ApiError(errorMessage(data, xhr.statusText || `Upload failed (${xhr.status})`), xhr.status));
      }
    };
    xhr.send(form);
  });
}

export const api = {
  signup: (b: { username: string; displayName: string; password: string }) =>
    request<AuthResponse>('POST', '/api/auth/signup', b, { noRedirect: true }),
  login: (b: { username: string; password: string }) =>
    request<AuthResponse>('POST', '/api/auth/login', b, { noRedirect: true }),
  me: () => request<User>('GET', '/api/me'),
  updateMe: (b: ProfilePatch) => request<User>('PATCH', '/api/me', b),
  getUser: (username: string) => request<UserProfile>('GET', `/api/users/${q(username)}${todayQs()}`),
  follow: (username: string) => request<{ following: boolean }>('POST', `/api/users/${q(username)}/follow`),
  unfollow: (username: string) => request<{ following: boolean }>('DELETE', `/api/users/${q(username)}/follow`),
  searchUsers: (query: string) => request<User[]>('GET', `/api/users/search?q=${q(query)}`),
  getSession: (id: string) => request<WorkSession>('GET', `/api/sessions/${q(id)}`),
  updateSession: (id: string, b: SessionPatch) => request<WorkSession>('PATCH', `/api/sessions/${q(id)}`, b),
  deleteSession: (id: string) => request<void>('DELETE', `/api/sessions/${q(id)}`),
  feed: (cursor?: string | null) => request<Page<WorkSession>>('GET', `/api/feed${cursorQs(cursor)}`),
  userSessions: (username: string, cursor?: string | null) =>
    request<Page<WorkSession>>('GET', `/api/users/${q(username)}/sessions${cursorQs(cursor)}`),
  giveKudos: (id: string) =>
    request<{ kudos: number; hasKudoed: boolean }>('POST', `/api/sessions/${q(id)}/kudos`),
  removeKudos: (id: string) =>
    request<{ kudos: number; hasKudoed: boolean }>('DELETE', `/api/sessions/${q(id)}/kudos`),
  comments: (id: string) => request<Comment[]>('GET', `/api/sessions/${q(id)}/comments`),
  addComment: (id: string, body: string) => request<Comment>('POST', `/api/sessions/${q(id)}/comments`, { body }),
  stats: () => request<Stats>('GET', `/api/stats/me${todayQs()}`),
  leaderboard: () => request<LeaderboardEntry[]>('GET', `/api/leaderboard?period=week${todayQs('&')}`),
  uploadSession,
};
