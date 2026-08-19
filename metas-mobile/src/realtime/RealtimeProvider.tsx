import { useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import { AppState } from 'react-native';

import { publicEnv } from '@/config/publicEnv';
import { useAuth } from '@/features/auth/context/AuthContext';
import { sessionTokenStorage } from '@/features/auth/storage/sessionTokenStorage';
import { RealtimeClient } from '@/realtime/realtimeClient';
import { RealtimeContext, type RealtimeContextValue } from '@/realtime/RealtimeContext';

export function RealtimeProvider({ children }: PropsWithChildren) {
  const { clearLocalSession, status, user } = useAuth();
  const [client] = useState<RealtimeClient | null>(() => {
    if (!publicEnv.isApiConfigured) {
      return null;
    }
    try {
      return new RealtimeClient({
        apiBaseUrl: publicEnv.apiBaseUrl,
        onUnauthorized: clearLocalSession,
        sessionTokenStorage,
      });
    } catch {
      return null;
    }
  });

  useEffect(() => {
    if (status === 'authenticated' && user) {
      client?.start();
    } else {
      client?.stop();
    }

    return () => client?.stop();
  }, [client, status, user]);

  useEffect(() => {
    client?.setForeground(AppState.currentState === 'active');
    const subscription = AppState.addEventListener('change', (nextState) => {
      client?.setForeground(nextState === 'active');
    });
    return () => subscription.remove();
  }, [client]);

  const value = useMemo<RealtimeContextValue>(
    () => ({
      subscribe: (type, listener) => {
        const subscription = client?.subscribe(type, listener);
        return () => subscription?.unsubscribe();
      },
    }),
    [client],
  );

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}
