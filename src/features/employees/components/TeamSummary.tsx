import { StyleSheet, View } from 'react-native';

import type { TeamRoleSummary } from '@/features/employees/types/employee.types';
import { USER_ROLE_LABELS } from '@/shared/config/userRoles';
import { AppText } from '@/shared/components';
import { colors, radius, shadows, spacing } from '@/shared/theme';
import type { UserRole } from '@/shared/types/userRole';

interface TeamSummaryProps {
  summary: TeamRoleSummary;
}

const ROLE_ORDER: readonly UserRole[] = ['GESTOR', 'BALCONISTA', 'FARMACEUTICO', 'CAIXA'];

export function TeamSummary({ summary }: TeamSummaryProps) {
  return (
    <View style={styles.container}>
      {ROLE_ORDER.map((role, index) => (
        <View
          key={role}
          style={[styles.item, index % 2 === 1 && styles.itemRight, index < 2 && styles.itemTop]}
        >
          <View style={styles.indicator} />
          <View style={styles.copy}>
            <AppText color="textMuted" numberOfLines={2} variant="caption">
              {USER_ROLE_LABELS[role].plural}
            </AppText>
            <AppText style={styles.value} variant="title">
              {summary[role]}
            </AppText>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...shadows.panel,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    overflow: 'hidden',
  },
  copy: {
    flex: 1,
    gap: spacing.xs,
    minWidth: 0,
  },
  indicator: {
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    height: 32,
    width: 4,
  },
  item: {
    alignItems: 'center',
    flexBasis: '50%',
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 84,
    padding: spacing.md,
  },
  itemRight: {
    borderLeftColor: colors.border,
    borderLeftWidth: 1,
  },
  itemTop: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  value: {
    fontSize: 22,
    letterSpacing: 0,
    lineHeight: 28,
  },
});
