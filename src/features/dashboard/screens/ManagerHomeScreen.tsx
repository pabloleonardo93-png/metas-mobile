import { useMemo } from 'react';
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, useWindowDimensions } from 'react-native';

import { appRoutes } from '@/config/routes';
import { useCampaigns } from '@/features/campaigns/context/CampaignsContext';
import { selectActiveCampaigns } from '@/features/campaigns/utils/campaign.utils';
import { EmployeesNearGoal } from '@/features/dashboard/components/EmployeesNearGoal';
import {
  ManagementShortcuts,
  type ManagementShortcut,
} from '@/features/dashboard/components/ManagementShortcuts';
import { ManagerBottomNavigation } from '@/features/dashboard/components/ManagerBottomNavigation';
import { ManagerHeader } from '@/features/dashboard/components/ManagerHeader';
import { ManagerQuickSummary } from '@/features/dashboard/components/ManagerQuickSummary';
import { PriorityProducts } from '@/features/dashboard/components/PriorityProducts';
import { StoreGoalCard } from '@/features/dashboard/components/StoreGoalCard';
import { TeamPerformance } from '@/features/dashboard/components/TeamPerformance';
import { managerDashboardMock } from '@/features/dashboard/mocks/managerDashboard.mock';
import { calculateManagerDashboardMetrics } from '@/features/dashboard/utils/calculateManagerDashboard';
import { useGoals } from '@/features/metas/context/GoalsContext';
import { ScreenContainer } from '@/shared/components';
import { colors, spacing } from '@/shared/theme';

const MANAGEMENT_ROUTES = {
  campaigns: appRoutes.managerCampaigns,
  goals: appRoutes.managerGoals,
  settings: appRoutes.managerGoalSettings,
  team: appRoutes.managerTeam,
} as const satisfies Record<ManagementShortcut, string>;

export function ManagerHomeScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { campaigns } = useCampaigns();
  const { currentGoal } = useGoals();
  const activeCampaigns = useMemo(() => selectActiveCampaigns(campaigns), [campaigns]);
  const horizontalPadding = Math.max(spacing.md, (width - 680) / 2);
  const metrics = calculateManagerDashboardMetrics(
    currentGoal,
    managerDashboardMock.team,
    activeCampaigns.length,
  );

  function handleShortcutPress(shortcut: ManagementShortcut) {
    router.push(MANAGEMENT_ROUTES[shortcut]);
  }

  return (
    <ScreenContainer edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingHorizontal: horizontalPadding }]}
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
      >
        <ManagerHeader name={managerDashboardMock.manager.name} />
        <StoreGoalCard metrics={metrics} />
        <ManagerQuickSummary metrics={metrics} />
        <TeamPerformance team={managerDashboardMock.team} />
        <PriorityProducts
          campaigns={activeCampaigns}
          onSeeAll={() => router.push(appRoutes.managerCampaigns)}
        />
        <EmployeesNearGoal employees={managerDashboardMock.employeesNearGoal} />
        <ManagementShortcuts onOpen={handleShortcutPress} />
      </ScrollView>

      <ManagerBottomNavigation activeTab="home" />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    backgroundColor: colors.background,
    flexGrow: 1,
    gap: spacing.md,
    paddingBottom: spacing.xl,
    paddingTop: spacing.lg,
  },
});
