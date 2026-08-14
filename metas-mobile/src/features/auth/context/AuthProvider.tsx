import { useCallback, useEffect, useMemo, useState, type PropsWithChildren } from 'react';

import { authApi } from '@/features/auth/api/authApi';
import { AuthContext, type AuthContextValue } from '@/features/auth/context/AuthContext';
import { googleSignInGateway } from '@/features/auth/google/googleSignIn';
import { AuthSessionController } from '@/features/auth/services/authSessionController';
import { sessionTokenStorage } from '@/features/auth/storage/sessionTokenStorage';
import type { AuthStatus, AuthUser, DemoArea } from '@/features/auth/types/auth.types';
import { getLoginErrorMessage } from '@/features/auth/utils/authErrorMessage';
import { currentEmployeeMock, currentManagerMock } from '@/features/employees/mocks/employees.mock';
import { setUnauthorizedHandler } from '@/shared/api/apiClient';

const sessionController = new AuthSessionController(
  authApi,
  sessionTokenStorage,
  googleSignInGateway,
);

function toDemoUser(area: DemoArea): AuthUser {
  const employee = area === 'manager' ? currentManagerMock : currentEmployeeMock;
  return {
    email: employee.email,
    id: employee.id,
    joinedOn: employee.joinedAt,
    name: employee.name,
    role: employee.role,
    status: employee.status,
  };
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [status, setStatus] = useState<AuthStatus>('restoring');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  const restoreSession = useCallback(async () => {
    setStatus('restoring');
    setErrorMessage(null);

    try {
      const restoredUser = await sessionController.restoreSession();
      setUser(restoredUser);
      setStatus(restoredUser ? 'authenticated' : 'unauthenticated');
    } catch {
      setUser(null);
      setStatus('restore-error');
      setErrorMessage(
        'Não foi possível verificar sua sessão. Verifique sua conexão e tente novamente.',
      );
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    void sessionController
      .restoreSession()
      .then((restoredUser) => {
        if (isMounted) {
          setUser(restoredUser);
          setStatus(restoredUser ? 'authenticated' : 'unauthenticated');
        }
      })
      .catch(() => {
        if (isMounted) {
          setUser(null);
          setStatus('restore-error');
          setErrorMessage(
            'Não foi possível verificar sua sessão. Verifique sua conexão e tente novamente.',
          );
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const loginWithGoogle = useCallback(async () => {
    if (isAuthenticating) {
      return;
    }

    setIsAuthenticating(true);
    setErrorMessage(null);
    try {
      const authenticatedUser = await sessionController.loginWithGoogle();
      if (authenticatedUser) {
        setUser(authenticatedUser);
        setStatus('authenticated');
      }
    } catch (error: unknown) {
      setErrorMessage(getLoginErrorMessage(error));
    } finally {
      setIsAuthenticating(false);
    }
  }, [isAuthenticating]);

  const logout = useCallback(async () => {
    setIsAuthenticating(true);
    try {
      await sessionController.logout();
    } catch {
      // Local logout is authoritative on the device even when the API is unavailable.
    } finally {
      setUser(null);
      setStatus('unauthenticated');
      setErrorMessage(null);
      setIsAuthenticating(false);
    }
  }, []);

  const clearLocalSession = useCallback(async () => {
    await sessionController.clearLocalSession();
    setUser(null);
    setStatus('unauthenticated');
    setErrorMessage(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(clearLocalSession);
    return () => setUnauthorizedHandler(null);
  }, [clearLocalSession]);

  const enterDemo = useCallback((area: DemoArea) => {
    if (!__DEV__) {
      return;
    }
    setUser(toDemoUser(area));
    setStatus('authenticated');
    setErrorMessage(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      clearLocalSession,
      enterDemo,
      errorMessage,
      isAuthenticating,
      loginWithGoogle,
      logout,
      retryRestore: restoreSession,
      status,
      user,
    }),
    [
      clearLocalSession,
      enterDemo,
      errorMessage,
      isAuthenticating,
      loginWithGoogle,
      logout,
      restoreSession,
      status,
      user,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
