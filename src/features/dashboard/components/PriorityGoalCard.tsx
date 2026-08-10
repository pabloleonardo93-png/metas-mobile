import { StyleSheet, View } from 'react-native';

import { GoalProgressBar } from '@/features/dashboard/components/GoalProgressBar';
import type { PriorityGoal } from '@/features/dashboard/types/employeeDashboard';
import { calculateProgress } from '@/features/dashboard/utils/calculateProgress';
import { formatBrazilianCurrency, formatPercentage } from '@/features/dashboard/utils/formatters';
import { AppText } from '@/shared/components';
import { colors, radius, shadows, spacing } from '@/shared/theme';

interface PriorityGoalCardProps {
  goal: PriorityGoal;
}

export function PriorityGoalCard({ goal }: PriorityGoalCardProps) {
  const progress = calculateProgress(goal.realizado, goal.objetivo);
  const progressDescription =
    goal.unidade === 'reais'
      ? `${formatBrazilianCurrency(goal.realizado)} / ${formatBrazilianCurrency(goal.objetivo)}`
      : `${goal.realizado} / ${goal.objetivo} ${goal.unidade}`;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.productCopy}>
          <AppText numberOfLines={2} variant="bodyMedium">
            {goal.produto}
          </AppText>
          <AppText color="textMuted" variant="caption">
            {progressDescription}
          </AppText>
        </View>
        <AppText color="primary" variant="bodyMedium">
          {formatPercentage(progress, 0)}
        </AppText>
      </View>

      <GoalProgressBar
        label={`Progresso de ${goal.produto}: ${formatPercentage(progress, 0)}`}
        progress={progress}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    ...shadows.panel,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.md,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  productCopy: {
    flex: 1,
    gap: spacing.xs,
  },
});
