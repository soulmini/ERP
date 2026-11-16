import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Permission } from '@erp/shared';
import { api, setSessionExpiredHandler, tokenStore } from './api';

export type View = 'admin' | 'teacher' | 'parent';

export const homePath = (v: View) => ({ admin: '/admin', teacher: '/teacher', parent: '/parent' })[v];

export interface Me {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  kinds: ('PRINCIPAL' | 'TEACHER' | 'PARENT' | 'STAFF')[];
  permissions: Permission[];
  view: View;
  staff: { id: string; designation: string; employeeCode: string } | null;
  guardianId: string | null;
  school: { id: string; name: string; city: string | null; logoUrl: string | null };
}

interface AuthCtx {
  user: Me | null;
  login: (identifier: string, password: string) => Promise<Me>;
  logout: () => Promise<void>;
  can: (...p: Permission[]) => boolean;
  refreshMe: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

function readCachedUser(): Me | null {
  try {
    return tokenStore.refresh ? (JSON.parse(localStorage.getItem(tokenStore.userKey) ?? 'null') as Me) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(readCachedUser);
  const qc = useQueryClient();

  const setMe = useCallback((me: Me | null) => {
    setUser(me);
    if (me) localStorage.setItem(tokenStore.userKey, JSON.stringify(me));
  }, []);

  useEffect(() => {
    setSessionExpiredHandler(() => {
      setUser(null);
      qc.clear();
    });
  }, [qc]);

  const refreshMe = useCallback(async () => {
    const { data } = await api.get<Me>('/auth/me');
    setMe(data);
  }, [setMe]);

  // Refresh profile in background on app start (permissions may have changed).
  useEffect(() => {
    if (user) refreshMe().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(
    async (identifier: string, password: string) => {
      const { data } = await api.post('/auth/login', { identifier, password });
      tokenStore.set(data.accessToken, data.refreshToken);
      setMe(data.user);
      return data.user as Me;
    },
    [setMe],
  );

  const logout = useCallback(async () => {
    const rt = tokenStore.refresh;
    tokenStore.clear();
    setUser(null);
    qc.clear();
    if (rt) await api.post('/auth/logout', { refreshToken: rt }).catch(() => {});
  }, [qc]);

  const can = useCallback(
    (...p: Permission[]) => !!user && (user.kinds.includes('PRINCIPAL') || p.some((x) => user.permissions.includes(x))),
    [user],
  );

  const value = useMemo(() => ({ user, login, logout, can, refreshMe }), [user, login, logout, can, refreshMe]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth outside AuthProvider');
  return c;
}
