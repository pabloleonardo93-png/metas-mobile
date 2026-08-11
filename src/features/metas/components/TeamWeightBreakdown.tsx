import { StyleSheet, View } from 'react-native';

import { TEAM_ROLE_LABELS } from '@/features/metas/config/teamRoles';
import type { TeamDistribution } from '@/features/metas/types/teamDistribution.types';
import { calculateTeamWeightSummary } from '@/features/metas/utils/calculateDailyGoals';
import { formatDecimal } from '@/features/metas/utils/formatCurrency';
import { AppText } from '@/shared/components';
import { colors, radius, spacing } from '@/shared/theme';

interface TeamWeightBreakdownProps {
  distribution: readonly TeamDistribution[];
}

export function TeamWeightBreakdown({ distribution }: TeamWeightBreakdownProps) {
  const summary = calculateTeamWeightSummary(distribution);

  return (
    <View style={styles.card}>
      <AppText variant="bodyMedium">Como os pesos são calculados</AppText>

      <View style={styles.rows}>
        {summary.roles.map((role) => {
          const labels = TEAM_ROLE_LABELS[role.role];
          const employeeLabel = role.quantity === 1 ? 'funcionário' : 'funcionários';

          return (
            <View key={role.role} style={styles.row}>
              <AppText variant="label">{labels.plural}</AppText>
              <AppText color="textMuted" variant="caption">
                {role.quantity} {employeeLabel} × peso {formatDecimal(role.weight)} ={' '}
                {formatDecimal(role.weightedGroupValue)}
              </AppText>
            </View>
          );
        })}
      </View>

      <View style={styles.totalRow}>
        <AppText variant="bodyMedium">Peso ponderado total</AppText>
        <AppText color="primary" variant="title">
          {formatDecimal(summary.totalTeamWeight)}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.primarySubtle,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.md,
  },
  row: {
    gap: spacing.xs,
  },
  rows: {
    gap: spacing.md,
  },
  totalRow: {
    alignItems: 'center',
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
    paddingTop: spacing.md,
  },
});
