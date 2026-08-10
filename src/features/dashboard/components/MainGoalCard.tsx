import { StyleSheet, View } from 'react-native';

import { GoalProgressBar } from '@/features/dashboard/components/GoalProgressBar';
import type { MonetaryGoal } from '@/features/dashboard/types/employeeDashboard';
import { calculateProgress } from '@/features/dashboard/utils/calculateProgress';
import { formatBrazilianCurrency, formatPercentage } from '@/features/dashboard/utils/formatters';
import { AppText } from '@/shared/components';
import { colors, radius, shadows, spacing } from '@/shared/theme';

interface MainGoalCardProps {
  goal: MonetaryGoal;
}

export function MainGoalCard({ goal }: MainGoalCardProps) {
  const progress = calculateProgress(goal.realizado, goal.objetivo);
  const remaining = Math.max(0, goal.objetivo - goal.realizado);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.labelGroup}>
          <View style={styles.eyebrow} />
          <AppText color="onPrimary" variant="label">
            Meta mensal
          </AppText>
        </View>
        <View style={styles.percentageBadge}>
          <AppText color="onPrimary" variant="label">
            {formatPercentage(progress)}
          </AppText>
        </View>
      </View>

      <AppText
        adjustsFontSizeToFit
        color="onPrimary"
        minimumFontScale={0.78}
        numberOfLines={1}
        variant="display"
      >
        {formatBrazilianCurrency(goal.realizado)} / {formatBrazilianCurrency(goal.objetivo)}
      </AppText>

      <GoalProgressBar
        label={`Progresso da meta mensal: ${formatPercentage(progress)}`}
        progress={progress}
        variant="inverse"
      />

      <AppText color="onPrimary" style={styles.supportingText} variant="caption">
        {remaining > 0
          ? `Faltam ${formatBrazilianCurrency(remaining)} para atingir sua meta`
          : 'Meta atingida. Excelente trabalho!'}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    ...shadows.card,
    backgroundColor: colors.primary,
    borderRadius: radius.xl,
    gap: spacing.lg,
    overflow: 'hidden',
    padding: spacing.lg,
  },
  eyebrow: {
    backgroundColor: colors.onPrimary,
    borderRadius: radius.pill,
    height: 8,
    width: 8,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  labelGroup: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  percentageBadge: {
    backgroundColor: colors.primaryPressed,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  supportingText: {
    opacity: 0.9,
  },
});
