import { StyleSheet, View } from 'react-native';

import { DashboardSectionHeader } from '@/features/dashboard/components/DashboardSectionHeader';
import type { ManagerTeamPerformance } from '@/features/dashboard/types/managerDashboard';
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

      {team.length > 0 ? (
        <View style={styles.card}>
          {team.map((item, index) => (
            <View key={item.role} style={[styles.row, index > 0 && styles.rowWithDivider]}>
              <View style={styles.copy}>
                <AppText variant="bodyMedium">{TEAM_ROLE_LABELS[item.role].plural}</AppText>
                <AppText color="textMuted" variant="caption">
                  {formatEmployeeCount(item.quantity)}
                </AppText>
              </View>
              <AppText color="textMuted" variant="caption">
                Desempenho ainda nÃ£o disponÃ­vel.
              </AppText>
            </View>
          ))}
        </View>
      ) : (
        <View style={styles.emptyState}>
          <AppText color="textMuted" variant="bodyMedium">
            Nenhum dado de desempenho disponível
          </AppText>
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
    overflow: 'hidden',
  },
  copy: {
    flex: 1,
    gap: spacing.xs,
  },
  emptyState: {
    ...shadows.panel,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.md,
  },
  row: {
    gap: spacing.md,
    padding: spacing.md,
  },
  rowWithDivider: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
  },
  section: {
    gap: spacing.md,
  },
});
