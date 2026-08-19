import { ScrollView, StyleSheet, useWindowDimensions } from 'react-native';

import { useCampaigns } from '@/features/campaigns/context/CampaignsContext';
import { useAuthenticatedEmployee } from '@/features/auth/context/AuthContext';
import { selectActiveCampaigns } from '@/features/campaigns/utils/campaign.utils';
import { EmployeeBottomNavigation } from '@/features/dashboard/components/EmployeeBottomNavigation';
import { EmployeeCampaignsSection } from '@/features/dashboard/components/EmployeeCampaignsSection';
import { EmployeeFinancialGoalCard } from '@/features/metas/components/EmployeeFinancialGoalCard';
import { useEmployeeGoal } from '@/features/metas/hooks/useEmployeeGoal';
import { AppScreenHeader, ScreenContainer } from '@/shared/components';
import { colors, spacing } from '@/shared/theme';

export function EmployeeGoalsScreen() {
  const currentEmployee = useAuthenticatedEmployee();
  const { width } = useWindowDimensions();
  const { campaigns } = useCampaigns();
  const { calculationResult, employeeGoal } = useEmployeeGoal(currentEmployee.role);
  const horizontalPadding = Math.max(spacing.md, (width - 680) / 2);
  const activeCampaigns = selectActiveCampaigns(campaigns);
  const goalStatusMessage =
    calculationResult.status === 'success' && !employeeGoal
      ? 'Seu cargo não possui meta individual na distribuição atual.'
      : calculationResult.message;

  return (
    <ScreenContainer edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingHorizontal: horizontalPadding }]}
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
      >
        <AppScreenHeader subtitle="Acompanhe seu objetivo e progresso" title="Minhas Metas" />

        <EmployeeFinancialGoalCard
          goal={employeeGoal}
          role={currentEmployee.role}
          statusMessage={goalStatusMessage}
        />

        <EmployeeCampaignsSection campaigns={activeCampaigns} contributions={[]} />
      </ScrollView>

      <EmployeeBottomNavigation activeTab="goals" />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    backgroundColor: colors.background,
    flexGrow: 1,
    gap: spacing.lg,
    paddingBottom: spacing.xl,
    paddingTop: spacing.lg,
  },
});
