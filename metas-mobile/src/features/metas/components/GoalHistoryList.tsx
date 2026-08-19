import { StyleSheet, View } from 'react-native';

import type { GoalHistoryItem, GoalStatus } from '@/features/metas/types/goalSettings.types';
import { AppProgressBar, AppText } from '@/shared/components';
import { colors, radius, shadows, spacing } from '@/shared/theme';
import { calculateProgress } from '@/shared/utils/calculateProgress';
import { formatBrazilianCurrency, formatPercentage } from '@/shared/utils/formatters';

interface GoalHistoryListProps {
  items: readonly GoalHistoryItem[];
}

const STATUS_LABELS = {
  CONCLUIDA: 'Concluída',
  EM_ANDAMENTO: 'Em andamento',
} as const satisfies Record<GoalStatus, string>;

export function GoalHistoryList({ items }: GoalHistoryListProps) {
  return (
    <View style={styles.section}>
      <View style={styles.heading}>
        <AppText accessibilityRole="header" variant="title">
          Histórico
        </AppText>
        <AppText color="textMuted" variant="caption">
          Acompanhamento mensal da meta financeira
        </AppText>
      </View>

      {items.length === 0 ? (
        <View style={styles.emptyState}>
          <AppText color="textMuted" variant="bodyMedium">
            Nenhum histórico disponível
          </AppText>
        </View>
      ) : (
        <View style={styles.list}>
          {items.map((item) => {
            const progress = calculateProgress(item.sold, item.target);
            const exceeded = item.target > 0 && item.sold > item.target;
            const inProgress = item.status === 'EM_ANDAMENTO';

            return (
              <View key={item.id} style={styles.card}>
                <View style={styles.cardHeader}>
                  <AppText variant="bodyMedium">{item.month}</AppText>
                  <View
                    style={[
                      styles.statusBadge,
                      inProgress ? styles.statusInProgress : styles.statusCompleted,
                    ]}
                  >
                    <AppText color={inProgress ? 'primary' : 'success'} variant="caption">
                      {STATUS_LABELS[item.status]}
                    </AppText>
                  </View>
                </View>

                <AppText variant="bodyMedium">
                  {formatBrazilianCurrency(item.sold)} / {formatBrazilianCurrency(item.target)}
                </AppText>

                <AppProgressBar
                  label={`Progresso de ${item.month}: ${formatPercentage(progress)}`}
                  progress={progress}
                />

                <View style={styles.progressRow}>
                  <AppText color="primary" variant="label">
                    {formatPercentage(progress)}
                  </AppText>
                  {exceeded ? (
                    <AppText color="success" variant="caption">
                      Meta superada
                    </AppText>
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>
      )}
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
  cardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  emptyState: {
    ...shadows.panel,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.md,
  },
  heading: {
    gap: spacing.xs,
  },
  list: {
    gap: spacing.sm,
  },
  progressRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  section: {
    gap: spacing.md,
  },
  statusBadge: {
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  statusCompleted: {
    backgroundColor: colors.successSubtle,
  },
  statusInProgress: {
    backgroundColor: colors.primarySubtle,
  },
});
