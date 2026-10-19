import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { authApi, type ApiUser, type PublicConfig } from '../api';

interface AuthContextValue {
  user: ApiUser | null;
  config: PublicConfig | null;
  storage: string;
  loading: boolean;
  isAdmin: boolean;
  refresh: () => Promise<void>;
  login: (email: string, password: string, turnstileToken?: string) => Promise<ApiUser>;
  register: (input: {
    email: string;
    password: string;
    displayName?: string;
    turnstileToken?: string;
    inviteCode?: string;
  }) => Promise<{ user: ApiUser; emailSent: boolean }>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<ApiUser | null>(null);
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [storage, setStorage] = useState('unknown');
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await authApi.me();
      setUser(data.user);
      setConfig(data.config);
      setStorage(data.storage);
    } catch {
      // 后端不可用时前端仍要能作为纯本地白板使用
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 标签页标题跟随后台「系统设置 → 站点名称」。
  // index.html 里写死的 <title> 只是首屏兜底，拿到配置后就会被覆盖。
  useEffect(() => {
    const siteName = config?.siteName?.trim();
    if (siteName) document.title = siteName;
  }, [config]);

  const login = useCallback(async (email: string, password: string, turnstileToken?: string) => {
    const data = await authApi.login({ email, password, turnstileToken });
    setUser(data.user);
    return data.user;
  }, []);

  const register = useCallback(
    async (input: {
      email: string;
      password: string;
      displayName?: string;
      turnstileToken?: string;
      inviteCode?: string;
    }) => {
      const data = await authApi.register(input);
      setUser(data.user);
      return data;
    },
    []
  );

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      setUser(null);
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      config,
      storage,
      loading,
      isAdmin: user?.role === 'admin',
      refresh,
      login,
      register,
      logout,
    }),
    [user, config, storage, loading, refresh, login, register, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth 必须在 AuthProvider 内使用');
  return context;
}
