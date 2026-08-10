import { Pressable, ScrollView, StyleSheet } from 'react-native';

import type { EmployeeRoleFilter } from '@/features/employees/types/employee.types';
import { USER_ROLE_LABELS } from '@/shared/config/userRoles';
import { AppText } from '@/shared/components';
import { colors, radius, spacing } from '@/shared/theme';

interface EmployeeRoleFiltersProps {
  selectedRole: EmployeeRoleFilter;
  onSelect: (role: EmployeeRoleFilter) => void;
}

const FILTERS: readonly { label: string; value: EmployeeRoleFilter }[] = [
  { label: 'Todos', value: 'ALL' },
  { label: USER_ROLE_LABELS.GESTOR.plural, value: 'GESTOR' },
  { label: USER_ROLE_LABELS.BALCONISTA.plural, value: 'BALCONISTA' },
  { label: USER_ROLE_LABELS.FARMACEUTICO.plural, value: 'FARMACEUTICO' },
  { label: USER_ROLE_LABELS.CAIXA.plural, value: 'CAIXA' },
];

export function EmployeeRoleFilters({ selectedRole, onSelect }: EmployeeRoleFiltersProps) {
  return (
    <ScrollView
      horizontal
      contentContainerStyle={styles.content}
      showsHorizontalScrollIndicator={false}
    >
      {FILTERS.map((filter) => {
        const isSelected = filter.value === selectedRole;

        return (
          <Pressable
            key={filter.value}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
            style={({ pressed }) => [
              styles.filter,
              isSelected && styles.filterSelected,
              pressed && styles.filterPressed,
            ]}
            onPress={() => onSelect(filter.value)}
          >
            <AppText color={isSelected ? 'onPrimary' : 'textMuted'} variant="label">
              {filter.label}
            </AppText>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.sm,
    paddingRight: spacing.md,
  },
  filter: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.pill,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: spacing.md,
  },
  filterPressed: {
    opacity: 0.72,
  },
  filterSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
});
