import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { Capacitor } from '@capacitor/core';

/**
 * API base URL.
 *  - Local dev: '/api' (Vite proxies to the Node API)
 *  - Production web / mobile app: VITE_API_URL, e.g. https://api.rryschool.in/api
 */
export const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || '/api';
export const SOURCE = Capacitor.isNativePlatform() ? 'APP' : 'WEB';

const KEYS = { access: 'erp.access', refresh: 'erp.refresh', user: 'erp.user' };

export const tokenStore = {
  get access() {
    return localStorage.getItem(KEYS.access);
  },
  get refresh() {
    return localStorage.getItem(KEYS.refresh);
  },
  set(access: string, refresh: string) {
    localStorage.setItem(KEYS.access, access);
    localStorage.setItem(KEYS.refresh, refresh);
  },
  clear() {
    Object.values(KEYS).forEach((k) => localStorage.removeItem(k));
  },
  userKey: KEYS.user,
};

export const api = axios.create({ baseURL: API_URL, timeout: 30_000 });

api.interceptors.request.use((config) => {
  const t = tokenStore.access;
  if (t) config.headers.Authorization = `Bearer ${t}`;
  return config;
});

/** Called when refresh fails, so the app can return to the login screen. */
let onSessionExpired: () => void = () => {};
export const setSessionExpiredHandler = (fn: () => void) => (onSessionExpired = fn);

// Single-flight refresh: many parallel 401s share one refresh request.
let refreshing: Promise<string | null> | null = null;
async function refreshAccess(): Promise<string | null> {
  const rt = tokenStore.refresh;
  if (!rt) return null;
  try {
    const { data } = await axios.post(`${API_URL}/auth/refresh`, { refreshToken: rt });
    tokenStore.set(data.accessToken, data.refreshToken);
    localStorage.setItem(tokenStore.userKey, JSON.stringify(data.user));
    return data.accessToken as string;
  } catch {
    return null;
  }
}

api.interceptors.response.use(
  (r) => r,
  async (error: AxiosError) => {
    const original = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined;
    if (error.response?.status === 401 && original && !original._retry && !original.url?.includes('/auth/')) {
      original._retry = true;
      refreshing ??= refreshAccess().finally(() => (refreshing = null));
      const token = await refreshing;
      if (token) {
        original.headers.Authorization = `Bearer ${token}`;
        return api(original);
      }
      tokenStore.clear();
      onSessionExpired();
    }
    return Promise.reject(error);
  },
);

/** Human-readable error message from an API error. */
export function errorMessage(e: unknown): string {
  const ax = e as AxiosError<{ error?: string; details?: { fieldErrors?: Record<string, string[]> } }>;
  const d = ax.response?.data;
  if (d?.details?.fieldErrors) {
    const first = Object.entries(d.details.fieldErrors)[0];
    if (first) return `${first[0]}: ${first[1][0]}`;
  }
  if (d?.error) return d.error;
  if (ax.code === 'ERR_NETWORK') return 'Cannot reach the server. Check your internet connection.';
  return (e as Error)?.message ?? 'Something went wrong';
}
