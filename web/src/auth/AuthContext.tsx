import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { User } from '@shared/types';
import { api, clearToken, getToken, setToken, setUnauthorizedHandler } from '../api/client';

interface AuthValue {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  signup: (username: string, displayName: string, password: string) => Promise<void>;
  logout: () => void;
  setUser: (u: User) => void;
}

const Ctx = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(() => !!getToken());

  useEffect(() => {
    setUnauthorizedHandler(() => setUserState(null));
    return () => setUnauthorizedHandler(null);
  }, []);

  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    api
      .me()
      .then((u) => !cancelled && setUserState(u))
      .catch(() => {
        /* 401 already cleared the token; other errors leave us logged out for now */
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const res = await api.login({ username: username.trim(), password });
    setToken(res.token);
    setUserState(res.user);
  }, []);

  const signup = useCallback(async (username: string, displayName: string, password: string) => {
    const res = await api.signup({ username: username.trim(), displayName: displayName.trim(), password });
    setToken(res.token);
    setUserState(res.user);
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setUserState(null);
  }, []);

  const value = useMemo<AuthValue>(
    () => ({ user, loading, login, signup, logout, setUser: setUserState }),
    [user, loading, login, signup, logout],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>');
  return v;
}
