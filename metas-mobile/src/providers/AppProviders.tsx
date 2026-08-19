import type { PropsWithChildren } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { CampaignsProvider } from '@/features/campaigns/context/CampaignsContext';
import { AuthProvider } from '@/features/auth/context/AuthProvider';
import { GoalsProvider } from '@/features/metas/context/GoalsContext';
import { RealtimeProvider } from '@/realtime/RealtimeProvider';

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <RealtimeProvider>
          <CampaignsProvider>
            <GoalsProvider>{children}</GoalsProvider>
          </CampaignsProvider>
        </RealtimeProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
