import { StyleSheet, View } from 'react-native';

import { DashboardSectionHeader } from '@/features/dashboard/components/DashboardSectionHeader';
import { GoalProgressBar } from '@/features/dashboard/components/GoalProgressBar';
import type { ManagerTeamPerformance } from '@/features/dashboard/types/managerDashboard';
import { calculateProgress } from '@/features/dashboard/utils/calculateProgress';
import { formatPercentage } from '@/features/dashboard/utils/formatters';
import { TEAM_ROLE_LABELS } from '@/features/metas/config/teamRoles';
import { AppText } from '@/shared/components';
import { colors, radius, shadows, spacing } from '@/shared/theme';

interface TeamPerformanceProps {
  team: readonly ManagerTeamPerformance[];
}

function formatEmployeeCount(quantity: number): string {
  return `${quantity} ${quantity === 1 ? 'funcionário' : 'funcionários'}`;
}

export function TeamPerformance({ team }: TeamPerformanceProps) {
  return (
    <View style={styles.section}>
      <DashboardSectionHeader title="Desempenho por equipe" />

      <View style={styles.card}>
        {team.map((item, index) => {
          const progress = calculateProgress(item.progress, 100);

          return (
            <View key={item.role} style={[styles.row, index > 0 && styles.rowWithDivider]}>
              <View style={styles.rowHeader}>
                <View style={styles.copy}>
                  <AppText variant="bodyMedium">{TEAM_ROLE_LABELS[item.role].plural}</AppText>
                  <AppText color="textMuted" variant="caption">
                    {formatEmployeeCount(item.quantity)}
                  </AppText>
                </View>
                <AppText color="primary" variant="bodyMedium">
                  {formatPercentage(progress, 0)}
                </AppText>
              </View>

              <GoalProgressBar
                label={`Desempenho de ${TEAM_ROLE_LABELS[item.role].plural}: ${formatPercentage(progress, 0)}`}
                progress={progress}
              />
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
  copy: {
    flex: 1,
    gap: spacing.xs,
  },
  row: {
    gap: spacing.md,
    padding: spacing.md,
  },
  rowHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  rowWithDivider: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
  },
  section: {
    gap: spacing.md,
  },
});
