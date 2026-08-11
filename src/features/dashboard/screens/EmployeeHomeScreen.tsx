import { useMemo } from 'react';
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { appRoutes } from '@/config/routes';
import { useCampaigns } from '@/features/campaigns/context/CampaignsContext';
import { selectActiveCampaigns } from '@/features/campaigns/utils/campaign.utils';
import { EmployeeBottomNavigation } from '@/features/dashboard/components/EmployeeBottomNavigation';
import { EmployeeCampaignsSection } from '@/features/dashboard/components/EmployeeCampaignsSection';
import { EmployeeHeader } from '@/features/dashboard/components/EmployeeHeader';
import { PerformanceSummary } from '@/features/dashboard/components/PerformanceSummary';
import { currentEmployeeMock } from '@/features/employees/mocks/employees.mock';
import { EmployeeFinancialGoalCard } from '@/features/metas/components/EmployeeFinancialGoalCard';
import { useEmployeeGoal } from '@/features/metas/hooks/useEmployeeGoal';
import {
  employeeCampaignContributionsMock,
  employeePerformanceMock,
} from '@/features/results/mocks/employeePerformance.mock';
import { calculateEmployeePerformanceSummary } from '@/features/results/utils/calculateEmployeePerformance';
import { USER_ROLE_LABELS } from '@/shared/config/userRoles';
import { AppText, ScreenContainer } from '@/shared/components';
import { colors, spacing } from '@/shared/theme';

export function EmployeeHomeScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { campaigns } = useCampaigns();
  const { calculationResult, employeeGoal } = useEmployeeGoal(currentEmployeeMock.role);
  const horizontalPadding = Math.max(spacing.lg, (width - 680) / 2);
  const employeeRole = USER_ROLE_LABELS[currentEmployeeMock.role].singular;
  const activeCampaigns = selectActiveCampaigns(campaigns).slice(0, 2);
  const performanceSummary = useMemo(
    () =>
      calculateEmployeePerformanceSummary(
        employeePerformanceMock.dailyResults,
        employeePerformanceMock.referenceDate,
      ),
    [],
  );
  const goalStatusMessage =
    calculationResult.status === 'success' && !employeeGoal
      ? 'Seu cargo não possui meta individual na distribuição atual.'
      : calculationResult.message;

  return (
    <ScreenContainer edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingHorizontal: horizontalPadding }]}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <EmployeeHeader name={currentEmployeeMock.name} />

        <AppText color="textMuted" variant="caption">
          Função: {employeeRole}
        </AppText>

        <EmployeeFinancialGoalCard
          compact
          goal={employeeGoal}
          role={currentEmployeeMock.role}
          statusMessage={goalStatusMessage}
          onSeeDetails={() => router.push(appRoutes.employeeGoals)}
        />

        <EmployeeCampaignsSection
          campaigns={activeCampaigns}
          contributions={employeeCampaignContributionsMock}
        />

        <View style={styles.section}>
          <AppText accessibilityRole="header" variant="title">
            Resumo do desempenho
          </AppText>
          <PerformanceSummary summary={performanceSummary} />
        </View>
      </ScrollView>

      <EmployeeBottomNavigation activeTab="home" />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    backgroundColor: colors.background,
    flexGrow: 1,
    gap: spacing.lg,
    paddingBottom: spacing.xl,
    paddingVertical: spacing.lg,
  },
  section: {
    gap: spacing.md,
  },
});
