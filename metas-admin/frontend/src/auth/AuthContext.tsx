import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { PropsWithChildren } from 'react';

import { adminApi, AdminApiError } from '../api/adminApi';
import type { AdminIdentity } from '../types';

type AuthState =
  | { kind: 'loading' }
  | { kind: 'unauthenticated' }
  | { kind: 'google-only'; admin: AdminIdentity }
  | { kind: 'verified'; admin: AdminIdentity }
  | { kind: 'error'; message: string };

interface AuthContextValue {
  loginWithGoogle: (credential: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  state: AuthState;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider = ({ children }: PropsWithChildren): React.JSX.Element => {
  const [state, setState] = useState<AuthState>({ kind: 'loading' });

  const refresh = useCallback(async () => {
    try {
      const admin = await adminApi.getMe();
      setState(
        admin.assuranceLevel === 'MFA_VERIFIED'
          ? { admin, kind: 'verified' }
          : { admin, kind: 'google-only' },
      );
    } catch (error) {
      if (error instanceof AdminApiError && error.status === 401) {
        setState({ kind: 'unauthenticated' });
        return;
      }
      setState({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Não foi possível validar sua sessão.',
      });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<AuthContextValue>(
    () => ({
      async loginWithGoogle(credential) {
        await adminApi.loginWithGoogle(credential);
        await refresh();
      },
      async logout() {
        try {
          await adminApi.logout();
        } finally {
          setState({ kind: 'unauthenticated' });
        }
      },
      refresh,
      state,
    }),
    [refresh, state],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth deve ser usado dentro de AuthProvider.');
  return value;
};
