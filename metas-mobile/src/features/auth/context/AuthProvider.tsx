import { useCallback, useEffect, useMemo, useState, type PropsWithChildren } from 'react';

import { authApi } from '@/features/auth/api/authApi';
import { AuthContext, type AuthContextValue } from '@/features/auth/context/AuthContext';
import { googleSignInGateway } from '@/features/auth/google/googleSignIn';
import { AuthSessionController } from '@/features/auth/services/authSessionController';
import { sessionTokenStorage } from '@/features/auth/storage/sessionTokenStorage';
import type { AuthStatus, AuthUser } from '@/features/auth/types/auth.types';
import { getLoginErrorMessage } from '@/features/auth/utils/authErrorMessage';
import { setUnauthorizedHandler } from '@/shared/api/apiClient';
import { useToast } from '@/shared/toast/ToastContext';

const sessionController = new AuthSessionController(
  authApi,
  sessionTokenStorage,
  googleSignInGateway,
);

export function AuthProvider({ children }: PropsWithChildren) {
  const { hideToast, showToast } = useToast();
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
    hideToast();
    try {
      const authenticatedUser = await sessionController.loginWithGoogle();
      if (authenticatedUser) {
        setUser(authenticatedUser);
        setStatus('authenticated');
      }
    } catch (error: unknown) {
      showToast({ message: getLoginErrorMessage(error), type: 'error' });
    } finally {
      setIsAuthenticating(false);
    }
  }, [hideToast, isAuthenticating, showToast]);

  const logout = useCallback(async () => {
    hideToast();
    setIsAuthenticating(true);
    setUser(null);
    setStatus('unauthenticated');
    setErrorMessage(null);
    try {
      await sessionController.logout();
    } catch {
      // Local logout is authoritative on the device even when the API is unavailable.
    } finally {
      setIsAuthenticating(false);
    }
  }, [hideToast]);

  const clearLocalSession = useCallback(async () => {
    hideToast();
    setUser(null);
    setStatus('unauthenticated');
    setErrorMessage(null);
    await sessionController.clearLocalSession();
  }, [hideToast]);

  useEffect(() => {
    setUnauthorizedHandler(clearLocalSession);
    return () => setUnauthorizedHandler(null);
  }, [clearLocalSession]);

  const value = useMemo<AuthContextValue>(
    () => ({
      clearLocalSession,
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
