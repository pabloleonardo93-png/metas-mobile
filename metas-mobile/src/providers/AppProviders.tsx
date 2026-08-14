import type { PropsWithChildren } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { CampaignsProvider } from '@/features/campaigns/context/CampaignsContext';
import { AuthProvider } from '@/features/auth/context/AuthProvider';
import { GoalsProvider } from '@/features/metas/context/GoalsContext';

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <CampaignsProvider>
          <GoalsProvider>{children}</GoalsProvider>
        </CampaignsProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
