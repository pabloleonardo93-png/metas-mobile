import { StyleSheet, View } from 'react-native';

import type { EmployeeStatus } from '@/features/employees/types/employee.types';
import { AppText } from '@/shared/components';
import { colors, radius, spacing } from '@/shared/theme';

interface EmployeeStatusBadgeProps {
  status: EmployeeStatus;
}

export function EmployeeStatusBadge({ status }: EmployeeStatusBadgeProps) {
  const isActive = status === 'ATIVO';

  return (
    <View style={[styles.badge, isActive ? styles.activeBadge : styles.inactiveBadge]}>
      <View style={[styles.dot, isActive ? styles.activeDot : styles.inactiveDot]} />
      <AppText color={isActive ? 'success' : 'textMuted'} style={styles.label} variant="caption">
        {isActive ? 'Ativo' : 'Inativo'}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  activeBadge: {
    backgroundColor: colors.successSubtle,
  },
  activeDot: {
    backgroundColor: colors.success,
  },
  badge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  dot: {
    borderRadius: radius.pill,
    height: 6,
    width: 6,
  },
  inactiveBadge: {
    backgroundColor: colors.background,
  },
  inactiveDot: {
    backgroundColor: colors.textMuted,
  },
  label: {
    fontSize: 12,
    letterSpacing: 0,
    lineHeight: 16,
  },
});
