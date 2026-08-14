import { StyleSheet, View } from 'react-native';

import type { DailyGoalPerformance } from '@/features/results/types/employeePerformance.types';
import { AppIcon, AppProgressBar, AppText } from '@/shared/components';
import { colors, radius, shadows, spacing } from '@/shared/theme';
import { formatBrazilianCurrency } from '@/shared/utils/formatters';

interface DailyGoalPerformanceCardProps {
  performance: DailyGoalPerformance;
}

function getStatusText(performance: DailyGoalPerformance): string {
  if (performance.status === 'EXCEEDED') {
    return `Meta superada em ${formatBrazilianCurrency(performance.exceededAmount)}`;
  }

  if (performance.status === 'ACHIEVED') {
    return 'Meta diária atingida.';
  }

  return `Faltam ${formatBrazilianCurrency(performance.remainingAmount)}`;
}

export function DailyGoalPerformanceCard({ performance }: DailyGoalPerformanceCardProps) {
  return (
    <View style={styles.section}>
      <AppText accessibilityRole="header" variant="title">
        Desempenho de hoje
      </AppText>

      {performance.status === 'UNAVAILABLE' ? (
        <View accessibilityLiveRegion="polite" style={styles.unavailableCard}>
          <View style={styles.iconContainer}>
            <AppIcon color={colors.primary} name="target" size={22} />
          </View>
          <View style={styles.unavailableCopy}>
            <AppText variant="bodyMedium">Meta diária indisponível</AppText>
            <AppText color="textMuted" variant="caption">
              O resultado de hoje não pode ser comparado até existir uma meta válida para o cargo.
            </AppText>
          </View>
        </View>
      ) : (
        <View style={styles.card}>
          <View style={styles.valuesRow}>
            <View style={styles.valueItem}>
              <AppText color="textMuted" variant="caption">
                Meta diária
              </AppText>
              <AppText
                adjustsFontSizeToFit
                minimumFontScale={0.75}
                numberOfLines={1}
                variant="bodyMedium"
              >
                {formatBrazilianCurrency(performance.dailyGoal)}
              </AppText>
            </View>
            <View style={[styles.valueItem, styles.valueItemBorder]}>
              <AppText color="textMuted" variant="caption">
                Vendido hoje
              </AppText>
              <AppText
                adjustsFontSizeToFit
                color="primary"
                minimumFontScale={0.75}
                numberOfLines={1}
                variant="bodyMedium"
              >
                {formatBrazilianCurrency(performance.soldAmount)}
              </AppText>
            </View>
          </View>

          <AppProgressBar
            label={`Progresso de hoje: ${formatBrazilianCurrency(performance.soldAmount)} vendidos de ${formatBrazilianCurrency(performance.dailyGoal)}`}
            progress={performance.progress}
          />

          <View style={styles.statusRow}>
            <View
              style={[
                styles.statusDot,
                performance.status === 'PENDING' ? styles.pendingDot : styles.successDot,
              ]}
            />
            <AppText
              color={performance.status === 'PENDING' ? 'textMuted' : 'success'}
              style={styles.statusText}
              variant="bodyMedium"
            >
              {getStatusText(performance)}
            </AppText>
          </View>
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
    gap: spacing.lg,
    padding: spacing.md,
  },
  iconContainer: {
    alignItems: 'center',
    backgroundColor: colors.primarySubtle,
    borderRadius: radius.pill,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  pendingDot: {
    backgroundColor: colors.primary,
  },
  section: {
    gap: spacing.md,
  },
  statusDot: {
    borderRadius: radius.pill,
    height: 9,
    width: 9,
  },
  statusRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  statusText: {
    flex: 1,
  },
  successDot: {
    backgroundColor: colors.success,
  },
  unavailableCard: {
    ...shadows.panel,
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
  },
  unavailableCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  valueItem: {
    flex: 1,
    gap: spacing.xs,
    minWidth: 0,
    paddingHorizontal: spacing.sm,
  },
  valueItemBorder: {
    borderLeftColor: colors.border,
    borderLeftWidth: 1,
  },
  valuesRow: {
    flexDirection: 'row',
  },
});
