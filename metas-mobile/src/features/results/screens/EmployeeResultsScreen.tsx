import { useMemo } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { useCampaigns } from '@/features/campaigns/context/CampaignsContext';
import { useAuthenticatedEmployee } from '@/features/auth/context/AuthContext';
import { EmployeeBottomNavigation } from '@/features/dashboard/components/EmployeeBottomNavigation';
import { PerformanceSummary } from '@/features/dashboard/components/PerformanceSummary';
import { useEmployeeGoal } from '@/features/metas/hooks/useEmployeeGoal';
import { CampaignContributionsSection } from '@/features/results/components/CampaignContributionsSection';
import { DailyGoalPerformanceCard } from '@/features/results/components/DailyGoalPerformanceCard';
import { RecentResultsList } from '@/features/results/components/RecentResultsList';
import {
  employeeCampaignContributionsMock,
  employeePerformanceMock,
} from '@/features/results/mocks/employeePerformance.mock';
import {
  calculateDailyGoalPerformance,
  calculateEmployeePerformanceSummary,
  getRecentDailyResults,
} from '@/features/results/utils/calculateEmployeePerformance';
import { AppIcon, AppScreenHeader, AppText, ScreenContainer } from '@/shared/components';
import { colors, radius, spacing } from '@/shared/theme';

export function EmployeeResultsScreen() {
  const currentEmployee = useAuthenticatedEmployee();
  const { width } = useWindowDimensions();
  const { campaigns } = useCampaigns();
  const { employeeGoal } = useEmployeeGoal(currentEmployee.role);
  const horizontalPadding = Math.max(spacing.md, (width - 680) / 2);
  const dailyGoal = employeeGoal?.dailyGoal ?? 0;
  const summary = useMemo(
    () =>
      calculateEmployeePerformanceSummary(
        employeePerformanceMock.dailyResults,
        employeePerformanceMock.referenceDate,
      ),
    [],
  );
  const todayPerformance = calculateDailyGoalPerformance(summary.todaySales, dailyGoal);
  const recentResults = useMemo(
    () =>
      getRecentDailyResults(
        employeePerformanceMock.dailyResults,
        employeePerformanceMock.referenceDate,
        dailyGoal,
      ),
    [dailyGoal],
  );
  const hasResults = recentResults.length > 0;

  return (
    <ScreenContainer edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingHorizontal: horizontalPadding }]}
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
      >
        <AppScreenHeader subtitle="Acompanhe seu desempenho" title="Resultados" />

        {hasResults ? (
          <>
            <PerformanceSummary summary={summary} />
            <DailyGoalPerformanceCard performance={todayPerformance} />
            <RecentResultsList items={recentResults} />
          </>
        ) : (
          <View style={styles.emptyResults}>
            <View style={styles.emptyIcon}>
              <AppIcon color={colors.primary} name="chart" size={24} />
            </View>
            <View style={styles.emptyCopy}>
              <AppText variant="bodyMedium">Nenhum resultado registrado ainda</AppText>
              <AppText color="textMuted" variant="caption">
                Seu desempenho aparecerá aqui quando houver vendas.
              </AppText>
            </View>
          </View>
        )}

        <CampaignContributionsSection
          campaigns={campaigns}
          contributions={employeeCampaignContributionsMock}
        />
      </ScrollView>

      <EmployeeBottomNavigation activeTab="results" />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  emptyCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  emptyIcon: {
    alignItems: 'center',
    backgroundColor: colors.primarySubtle,
    borderRadius: radius.pill,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  emptyResults: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
  },
  scrollContent: {
    backgroundColor: colors.background,
    flexGrow: 1,
    gap: spacing.lg,
    paddingBottom: spacing.xl,
    paddingTop: spacing.lg,
  },
});
