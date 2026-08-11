import { StyleSheet, View } from 'react-native';

import type {
  DailyGoalPerformanceStatus,
  DailyResultWithPerformance,
} from '@/features/results/types/employeePerformance.types';
import { formatResultDate } from '@/features/results/utils/calculateEmployeePerformance';
import { AppText } from '@/shared/components';
import { colors, radius, shadows, spacing } from '@/shared/theme';
import { formatBrazilianCurrency } from '@/shared/utils/formatters';

interface RecentResultsListProps {
  items: readonly DailyResultWithPerformance[];
}

const STATUS_LABELS: Record<DailyGoalPerformanceStatus, string> = {
  ACHIEVED: 'Meta atingida',
  EXCEEDED: 'Meta superada',
  PENDING: 'Abaixo da meta',
  UNAVAILABLE: 'Sem comparação',
};

export function RecentResultsList({ items }: RecentResultsListProps) {
  return (
    <View style={styles.section}>
      <View style={styles.heading}>
        <AppText accessibilityRole="header" variant="title">
          Últimos dias
        </AppText>
        <AppText color="textMuted" variant="caption">
          Comparação com a meta diária atual
        </AppText>
      </View>

      <View style={styles.card}>
        {items.map((item, index) => {
          const reachedGoal =
            item.performance.status === 'ACHIEVED' || item.performance.status === 'EXCEEDED';

          return (
            <View key={item.date} style={[styles.row, index > 0 && styles.rowBorder]}>
              <View style={styles.dateBadge}>
                <AppText variant="label">{formatResultDate(item.date)}</AppText>
              </View>
              <View style={styles.resultCopy}>
                <AppText variant="bodyMedium">{formatBrazilianCurrency(item.soldAmount)}</AppText>
                <AppText color={reachedGoal ? 'success' : 'textMuted'} variant="caption">
                  {STATUS_LABELS[item.performance.status]}
                </AppText>
              </View>
            </View>
          );
        })}
      </View>
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
    overflow: 'hidden',
  },
  dateBadge: {
    alignItems: 'center',
    backgroundColor: colors.primarySubtle,
    borderRadius: radius.sm,
    justifyContent: 'center',
    minHeight: 40,
    width: 58,
  },
  heading: {
    gap: spacing.xs,
  },
  resultCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 72,
    padding: spacing.md,
  },
  rowBorder: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
  },
  section: {
    gap: spacing.md,
  },
});
