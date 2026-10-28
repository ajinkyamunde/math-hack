import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { authService, type RegisterInput } from '../../services/authService';
import { disconnectSocket } from '../../services/socketService';
import type { SessionResponse, User } from '../../types';

export interface AuthContextValue {
  user: User | null;
  loading: boolean;
  loginStudent: (identifier: string, password: string) => Promise<User>;
  loginHost: (email: string, password: string) => Promise<User>;
  register: (input: RegisterInput) => Promise<User>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

/** Session state comes from the server (/auth/me). The browser never stores roles or tokens itself. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const accept = useCallback((session: SessionResponse) => {
    // A new identity must not reuse a socket authenticated as someone else.
    disconnectSocket();
    setUser(session.user);
    return session.user;
  }, []);

  const refresh = useCallback(async () => {
    try {
      const session = await authService.me();
      setUser(session.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      refresh,
      loginStudent: async (identifier, password) => accept(await authService.loginStudent(identifier, password)),
      loginHost: async (email, password) => accept(await authService.loginHost(email, password)),
      register: async (input) => accept(await authService.register(input)),
      logout: async () => {
        try {
          await authService.logout();
        } finally {
          disconnectSocket();
          setUser(null);
        }
      },
    }),
    [user, loading, refresh, accept],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
