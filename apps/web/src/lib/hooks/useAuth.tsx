import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import { getApiClient, ApiRequestError, ApiNetworkError, setApiAccessToken } from '../api';
import { cacheUser, getCachedUser, getOfflineUserHint, setOfflineUserScope } from '../offline';
import type { User, Session, RegisterRequest, LoginRequest, ForgotPasswordRequest, ResetPasswordRequest, ChangePasswordRequest } from '../api/types';

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (data: LoginRequest) => Promise<void>;
  register: (data: RegisterRequest) => Promise<void>;
  startDemoSession: () => Promise<void>;
  logout: () => Promise<void>;
  forgotPassword: (data: ForgotPasswordRequest) => Promise<void>;
  resetPassword: (data: ResetPasswordRequest) => Promise<void>;
  changePassword: (data: ChangePasswordRequest) => Promise<void>;
  updateUser: (user: Partial<User>) => void;
  error: string | null;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const validationFieldLabels: Record<string, string> = {
  email: 'Correo electrónico',
  password: 'Contraseña',
  name: 'Nombre',
  body: 'Datos',
  rememberMe: 'Mantener sesión',
};

function readableAuthError(error: unknown, fallback: string): string {
  if (!(error instanceof ApiRequestError)) return fallback;
  const details = error.details;
  if (!details || !Object.keys(details).length) return error.message;
  const descriptions = Object.entries(details).flatMap(([field, messages]) =>
    messages.map(message => `${validationFieldLabels[field] ?? field}: ${message}`)
  );
  return descriptions.length ? `${error.message}. ${descriptions.join('. ')}` : error.message;
}


function userToOfflineRecord(user: User) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl ?? undefined,
    locale: user.locale,
    timezone: user.timezone,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    groups: [] as string[],
  };
}

function userFromOfflineRecord(record: NonNullable<Awaited<ReturnType<typeof getCachedUser>>>): User {
  const timestamp = record.cachedAt || new Date().toISOString();
  return {
    id: record.id,
    name: record.name,
    email: record.email,
    avatarUrl: record.avatarUrl,
    locale: record.locale ?? 'es-CO',
    timezone: record.timezone ?? 'America/Bogota',
    createdAt: record.createdAt ?? timestamp,
    updatedAt: record.updatedAt ?? timestamp,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const api = getApiClient();

  const clearError = useCallback(() => setError(null), []);

  const setAuth = useCallback((newSession: Session) => {
    setSession(newSession);
    setUser(newSession.user);
    setApiAccessToken(newSession.accessToken || null);
    setOfflineUserScope(newSession.user.id);
    void cacheUser(userToOfflineRecord(newSession.user)).catch((cacheError) => {
      console.warn('[Pazito] No se pudo guardar el perfil local para modo offline:', cacheError);
    });
  }, []);

  const clearAuth = useCallback(() => {
    setSession(null);
    setUser(null);
    setApiAccessToken(null);
    setOfflineUserScope(null);
  }, []);

  // Clear the in-memory session when any API request receives HTTP 401.
  useEffect(() => {
    const handleUnauthorized = () => clearAuth();
    window.addEventListener('pazito:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('pazito:unauthorized', handleUnauthorized);
  }, [clearAuth]);

  // Initialize auth on mount
  useEffect(() => {
    const initAuth = async () => {
      try {
        const currentUser = await api.getCurrentUser();
        setUser(currentUser);
        setSession(null);
        setApiAccessToken(null);
        setOfflineUserScope(currentUser.id);
        void cacheUser(userToOfflineRecord(currentUser)).catch((cacheError) => {
          console.warn('[Pazito] No se pudo actualizar el perfil local:', cacheError);
        });
      } catch (err) {
        const isExplicitlyUnauthorized = err instanceof ApiRequestError && err.status === 401;
        const networkUnavailable = !isExplicitlyUnauthorized && (
          err instanceof ApiNetworkError ||
          (typeof navigator !== 'undefined' && !navigator.onLine)
        );

        // On a cold offline start, restore only the cached identity for this
        // browser. No access token is persisted; all writes remain queued in
        // IndexedDB and the server revalidates permissions when syncing.
        if (networkUnavailable) {
          const hintedUserId = getOfflineUserHint();
          if (hintedUserId) {
            setOfflineUserScope(hintedUserId);
            const cachedUser = await getCachedUser().catch(() => undefined);
            if (cachedUser && cachedUser.id === hintedUserId) {
              setSession(null);
              setApiAccessToken(null);
              setUser(userFromOfflineRecord(cachedUser));
              return;
            }
          }
        }

        // A server-side 401 still means the session needs a real sign-in.
        clearAuth();
      } finally {
        setIsLoading(false);
      }
    };

    initAuth();
  }, [api, clearAuth]);

  const login = useCallback(async (data: LoginRequest) => {
    setError(null);
    setIsLoading(true);
    try {
      const newSession = await api.login(data);
      setAuth(newSession);
    } catch (err) {
      setError(readableAuthError(err, 'Error al iniciar sesión. Intenta de nuevo.'));
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [api, setAuth]);

  const register = useCallback(async (data: RegisterRequest) => {
    setError(null);
    setIsLoading(true);
    try {
      const newSession = await api.register(data);
      setAuth(newSession);
    } catch (err) {
      setError(readableAuthError(err, 'Error al crear la cuenta. Intenta de nuevo.'));
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [api, setAuth]);

  const startDemoSession = useCallback(async () => {
    setError(null);
    setIsLoading(true);
    try {
      const demoSession = await api.startDemoSession();
      setAuth(demoSession);
    } catch (err) {
      setError(readableAuthError(err, 'No se pudo iniciar la demostración. Intenta de nuevo.'));
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [api, setAuth]);

  const logout = useCallback(async () => {
    setIsLoading(true);
    try {
      await api.logout();
    } catch {
      // Ignore logout errors
    } finally {
      clearAuth();
      setIsLoading(false);
    }
  }, [api, clearAuth]);

  const forgotPassword = useCallback(async (data: ForgotPasswordRequest) => {
    setError(null);
    try {
      await api.forgotPassword(data);
    } catch (err) {
      setError(readableAuthError(err, 'Error al solicitar restablecimiento. Intenta de nuevo.'));
      throw err;
    }
  }, [api]);

  const resetPassword = useCallback(async (data: ResetPasswordRequest) => {
    setError(null);
    try {
      await api.resetPassword(data);
    } catch (err) {
      setError(readableAuthError(err, 'Error al restablecer la contraseña. Intenta de nuevo.'));
      throw err;
    }
  }, [api]);

  const changePassword = useCallback(async (data: ChangePasswordRequest) => {
    setError(null);
    try {
      await api.changePassword(data);
    } catch (err) {
      setError(readableAuthError(err, 'Error al cambiar la contraseña. Intenta de nuevo.'));
      throw err;
    }
  }, [api]);

  const updateUser = useCallback((userData: Partial<User>) => {
    if (!user) return;
    const updatedUser = { ...user, ...userData };
    setUser(updatedUser);
    setSession((prev) => (prev ? { ...prev, user: updatedUser } : null));
    void cacheUser(userToOfflineRecord(updatedUser)).catch((cacheError) => {
      console.warn('[Pazito] No se pudo actualizar el perfil local:', cacheError);
    });
  }, [user]);

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        isLoading,
        isAuthenticated: !!user,
        login,
        register,
        startDemoSession,
        logout,
        forgotPassword,
        resetPassword,
        changePassword,
        updateUser,
        error,
        clearError,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}