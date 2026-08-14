import { StyleSheet, View } from 'react-native';

import { DashboardSectionHeader } from '@/features/dashboard/components/DashboardSectionHeader';
import type { ManagerEmployeeNearGoal } from '@/features/dashboard/types/managerDashboard';
import { calculateProgress } from '@/features/dashboard/utils/calculateProgress';
import { formatPercentage } from '@/features/dashboard/utils/formatters';
import { USER_ROLE_LABELS } from '@/shared/config/userRoles';
import { AppText } from '@/shared/components';
import { colors, radius, shadows, spacing } from '@/shared/theme';
import { getInitials } from '@/shared/utils/getInitials';

interface EmployeesNearGoalProps {
  employees: readonly ManagerEmployeeNearGoal[];
}

export function EmployeesNearGoal({ employees }: EmployeesNearGoalProps) {
  return (
    <View style={styles.section}>
      <DashboardSectionHeader title="Mais próximos da meta" />

      <View style={styles.card}>
        {employees.map((employee, index) => {
          const progress = calculateProgress(employee.progress, 100);

          return (
            <View key={employee.id} style={[styles.row, index > 0 && styles.rowWithDivider]}>
              <View
                accessible
                accessibilityLabel={`Avatar de ${employee.name}`}
                style={styles.avatar}
              >
                <AppText color="primary" variant="label">
                  {getInitials(employee.name)}
                </AppText>
              </View>

              <View style={styles.copy}>
                <AppText variant="bodyMedium">{employee.name}</AppText>
                <AppText color="textMuted" variant="caption">
                  {USER_ROLE_LABELS[employee.role].singular}
                </AppText>
              </View>

              <View style={styles.progressBadge}>
                <AppText color="primary" variant="bodyMedium">
                  {formatPercentage(progress, 0)}
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
  avatar: {
    alignItems: 'center',
    backgroundColor: colors.primarySubtle,
    borderRadius: radius.pill,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
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
  progressBadge: {
    backgroundColor: colors.primarySubtle,
    borderRadius: radius.pill,
    minWidth: 56,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 72,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  rowWithDivider: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
  },
  section: {
    gap: spacing.md,
  },
});
