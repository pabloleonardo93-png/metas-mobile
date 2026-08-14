import { Pressable, StyleSheet, View } from 'react-native';

import { EmployeeAvatar } from '@/features/employees/components/EmployeeAvatar';
import { EmployeeStatusBadge } from '@/features/employees/components/EmployeeStatusBadge';
import type { Employee } from '@/features/employees/types/employee.types';
import { USER_ROLE_LABELS } from '@/shared/config/userRoles';
import { AppIcon, AppText } from '@/shared/components';
import { colors, radius, shadows, spacing } from '@/shared/theme';

interface EmployeeCardProps {
  employee: Employee;
  onPress: () => void;
}

export function EmployeeCard({ employee, onPress }: EmployeeCardProps) {
  return (
    <Pressable
      accessibilityHint="Abre os detalhes do funcionário"
      accessibilityLabel={`${employee.name}, ${USER_ROLE_LABELS[employee.role].singular}`}
      accessibilityRole="button"
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={onPress}
    >
      <EmployeeAvatar name={employee.name} />

      <View style={styles.copy}>
        <AppText numberOfLines={1} variant="bodyMedium">
          {employee.name}
        </AppText>
        <AppText color="textMuted" numberOfLines={1} variant="caption">
          {USER_ROLE_LABELS[employee.role].singular}
        </AppText>
        <EmployeeStatusBadge status={employee.status} />
      </View>

      <AppIcon color={colors.textMuted} name="chevron-right" size={22} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    ...shadows.panel,
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 104,
    padding: spacing.md,
  },
  cardPressed: {
    backgroundColor: colors.primarySubtle,
    opacity: 0.8,
  },
  copy: {
    flex: 1,
    gap: spacing.xs,
    minWidth: 0,
  },
});
