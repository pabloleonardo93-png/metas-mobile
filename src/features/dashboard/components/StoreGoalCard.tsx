import { StyleSheet, View } from 'react-native';

import { GoalProgressBar } from '@/features/dashboard/components/GoalProgressBar';
import { formatBrazilianCurrency, formatPercentage } from '@/features/dashboard/utils/formatters';
import type { CurrentGoalMetrics } from '@/features/metas/types/goalSettings.types';
import { AppText } from '@/shared/components';
import { colors, radius, shadows, spacing } from '@/shared/theme';

interface StoreGoalCardProps {
  metrics: CurrentGoalMetrics;
}

export function StoreGoalCard({ metrics }: StoreGoalCardProps) {
  const statusText =
    metrics.remaining > 0
      ? `Faltam ${formatBrazilianCurrency(metrics.remaining)}`
      : 'Meta mensal atingida.';

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
            {formatPercentage(metrics.progress, 0)}
          </AppText>
        </View>
      </View>

      <View style={styles.amountGroup}>
        <AppText
          adjustsFontSizeToFit
          color="onPrimary"
          minimumFontScale={0.78}
          numberOfLines={1}
          style={styles.amount}
          variant="display"
        >
          {formatBrazilianCurrency(metrics.sold)} vendidos
        </AppText>
        <AppText color="onPrimary" style={styles.supportingText} variant="caption">
          de {formatBrazilianCurrency(metrics.target)}
        </AppText>
      </View>

      <GoalProgressBar
        label={`Progresso da meta mensal da loja: ${formatPercentage(metrics.progress, 0)}`}
        progress={metrics.progress}
        variant="inverse"
      />

      <AppText color="onPrimary" style={styles.supportingText} variant="caption">
        {statusText}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  amount: {
    fontSize: 28,
    letterSpacing: 0,
    lineHeight: 36,
  },
  amountGroup: {
    gap: spacing.xs,
  },
  card: {
    ...shadows.card,
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    gap: spacing.md,
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
