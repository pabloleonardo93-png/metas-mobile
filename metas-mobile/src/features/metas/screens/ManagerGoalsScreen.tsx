import { useMemo } from 'react';
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { appRoutes } from '@/config/routes';
import { ManagerBottomNavigation } from '@/features/dashboard/components/ManagerBottomNavigation';
import { StoreGoalCard } from '@/features/dashboard/components/StoreGoalCard';
import { CurrentGoalDistribution } from '@/features/metas/components/CurrentGoalDistribution';
import { GoalHistoryList } from '@/features/metas/components/GoalHistoryList';
import { GoalQuickSummary } from '@/features/metas/components/GoalQuickSummary';
import { useGoals } from '@/features/metas/context/GoalsContext';
import { goalHistoryMock } from '@/features/metas/mocks/goalHistory.mock';
import type { GoalHistoryItem } from '@/features/metas/types/goalSettings.types';
import { calculateCurrentGoalMetrics } from '@/features/metas/utils/calculateCurrentGoal';
import { calculateDailyGoals } from '@/features/metas/utils/calculateDailyGoals';
import { AppText, ScreenContainer } from '@/shared/components';
import { colors, spacing } from '@/shared/theme';

export function ManagerGoalsScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { currentGoal, teamDistribution } = useGoals();
  const horizontalPadding = Math.max(spacing.md, (width - 680) / 2);
  const metrics = calculateCurrentGoalMetrics(currentGoal);
  const distributionResult = calculateDailyGoals(currentGoal, teamDistribution);
  const historyItems = useMemo<GoalHistoryItem[]>(
    () => [
      {
        id: currentGoal.id,
        month: currentGoal.month,
        sold: currentGoal.soldAmount,
        status: currentGoal.status,
        target: currentGoal.monthlyTarget,
      },
      ...goalHistoryMock,
    ],
    [currentGoal],
  );

  return (
    <ScreenContainer edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingHorizontal: horizontalPadding }]}
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={styles.headerAccent} />
          <View style={styles.headerCopy}>
            <AppText accessibilityRole="header" variant="title">
              Metas
            </AppText>
            <AppText color="textMuted">Acompanhe o desempenho financeiro da loja</AppText>
          </View>
        </View>

        <StoreGoalCard metrics={metrics} />
        <GoalQuickSummary metrics={metrics} />
        <CurrentGoalDistribution
          result={distributionResult}
          onOpenFullCalculation={() => router.push(appRoutes.managerGoalSettings)}
        />
        <GoalHistoryList items={historyItems} />
      </ScrollView>

      <ManagerBottomNavigation activeTab="goals" />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  headerAccent: {
    backgroundColor: colors.primary,
    borderRadius: 2,
    height: 44,
    width: 4,
  },
  headerCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  scrollContent: {
    backgroundColor: colors.background,
    flexGrow: 1,
    gap: spacing.lg,
    paddingBottom: spacing.xl,
    paddingTop: spacing.lg,
  },
});
