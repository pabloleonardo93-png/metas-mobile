import type { PropsWithChildren } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { CampaignsProvider } from '@/features/campaigns/context/CampaignsContext';
import { GoalsProvider } from '@/features/metas/context/GoalsContext';

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <SafeAreaProvider>
      <CampaignsProvider>
        <GoalsProvider>{children}</GoalsProvider>
      </CampaignsProvider>
    </SafeAreaProvider>
  );
}
