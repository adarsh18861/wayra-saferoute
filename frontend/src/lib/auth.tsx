import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiError, apiLogin, apiMe, apiRegister, getToken, setToken, type User } from "./api";

type AuthState = {
  user: User | null;
  /** True while a stored token is being checked on app start. */
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthState | null>(null);

// Last signed-in user, so the app (and the offline SOS) still opens when the server can't be reached.
const USER_KEY = "wayra.user";
function cacheUser(u: User | null) {
  try {
    if (u) localStorage.setItem(USER_KEY, JSON.stringify(u));
    else localStorage.removeItem(USER_KEY);
  } catch {
    /* storage unavailable */
  }
}
function cachedUser(): User | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(() => getToken() !== null);

  useEffect(() => {
    if (!getToken()) return;
    let cancelled = false;
    apiMe()
      .then((u) => {
        cacheUser(u);
        if (!cancelled) setUser(u);
      })
      .catch((err: unknown) => {
        // Drop the token only if the server rejected it. Offline / server down: keep the session with
        // the cached user so the app shell and the offline SOS still work.
        if (err instanceof ApiError && err.status === 401) {
          setToken(null);
          cacheUser(null);
        } else if (!cancelled) setUser(cachedUser());
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await apiLogin(email, password);
    setToken(res.access_token);
    cacheUser(res.user);
    setUser(res.user);
  }, []);

  const register = useCallback(async (name: string, email: string, password: string) => {
    const res = await apiRegister(name, email, password);
    setToken(res.access_token);
    cacheUser(res.user);
    setUser(res.user);
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    cacheUser(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, register, logout }),
    [user, loading, login, register, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
