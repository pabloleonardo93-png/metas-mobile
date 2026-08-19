import { useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { ActivityIndicator, FlatList, StyleSheet, useWindowDimensions, View } from 'react-native';

import { appRoutes } from '@/config/routes';
import { EmployeeCard } from '@/features/employees/components/EmployeeCard';
import { EmployeeRoleFilters } from '@/features/employees/components/EmployeeRoleFilters';
import { EmployeeScreenHeader } from '@/features/employees/components/EmployeeScreenHeader';
import { EmployeeSearch } from '@/features/employees/components/EmployeeSearch';
import { TeamSummary } from '@/features/employees/components/TeamSummary';
import { useEmployees } from '@/features/employees/context/EmployeesContext';
import type { EmployeeRoleFilter } from '@/features/employees/types/employee.types';
import {
  countActiveEmployees,
  filterEmployees,
  summarizeTeamByRole,
} from '@/features/employees/utils/employee.utils';
import { ManagerBottomNavigation } from '@/features/dashboard/components/ManagerBottomNavigation';
import { AppButton, AppIcon, AppText, ScreenContainer } from '@/shared/components';
import { colors, spacing } from '@/shared/theme';

export function EmployeesScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { employees, errorMessage, isLoading, refreshEmployees } = useEmployees();
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<EmployeeRoleFilter>('ALL');
  const horizontalPadding = Math.max(spacing.md, (width - 680) / 2);
  const activeCount = useMemo(() => countActiveEmployees(employees), [employees]);
  const teamSummary = useMemo(() => summarizeTeamByRole(employees), [employees]);
  const filteredEmployees = useMemo(
    () => filterEmployees(employees, search, roleFilter),
    [employees, roleFilter, search],
  );
  const activeCountLabel = `${activeCount} ${activeCount === 1 ? 'funcionário ativo' : 'funcionários ativos'}`;

  return (
    <ScreenContainer edges={['top', 'bottom']}>
      <FlatList
        contentContainerStyle={[styles.listContent, { paddingHorizontal: horizontalPadding }]}
        data={filteredEmployees}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        keyExtractor={(employee) => employee.id}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            {isLoading ? (
              <>
                <ActivityIndicator color={colors.primary} size="large" />
                <AppText color="textMuted">Carregando equipe...</AppText>
              </>
            ) : errorMessage ? (
              <>
                <AppIcon color={colors.error} name="settings" size={32} />
                <AppText style={styles.emptyText}>{errorMessage}</AppText>
                <AppButton
                  label="Tentar novamente"
                  variant="secondary"
                  onPress={() => void refreshEmployees()}
                />
              </>
            ) : (
              <>
                <AppIcon color={colors.textMuted} name="users" size={32} />
                <AppText variant="bodyMedium">Nenhum funcionário encontrado</AppText>
                <AppText color="textMuted" style={styles.emptyText} variant="caption">
                  Ajuste a busca ou selecione outro cargo.
                </AppText>
              </>
            )}
          </View>
        }
        ListHeaderComponent={
          <View style={styles.headerContent}>
            <EmployeeScreenHeader title="Equipe" subtitle="Gerencie os colaboradores da loja" />
            <AppText color="textMuted" variant="label">
              {activeCountLabel}
            </AppText>
            <TeamSummary summary={teamSummary} />
            <EmployeeSearch value={search} onChangeText={setSearch} />
            <EmployeeRoleFilters selectedRole={roleFilter} onSelect={setRoleFilter} />
            <AppButton
              label="Adicionar funcionário"
              leftIcon={<AppIcon color={colors.onPrimary} name="plus" size={22} />}
              onPress={() => router.push(appRoutes.managerNewEmployee)}
            />
            <AppText accessibilityRole="header" style={styles.sectionTitle} variant="title">
              Funcionários
            </AppText>
          </View>
        }
        onRefresh={() => void refreshEmployees()}
        refreshing={isLoading && employees.length > 0}
        renderItem={({ item }) => (
          <EmployeeCard
            employee={item}
            onPress={() => router.push(appRoutes.managerEmployeeDetails(item.id))}
          />
        )}
        showsVerticalScrollIndicator={false}
      />

      <ManagerBottomNavigation activeTab="team" />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  emptyState: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
  },
  emptyText: {
    textAlign: 'center',
  },
  headerContent: {
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  listContent: {
    backgroundColor: colors.background,
    flexGrow: 1,
    paddingBottom: spacing.xl,
    paddingTop: spacing.lg,
  },
  sectionTitle: {
    fontSize: 20,
    letterSpacing: 0,
    lineHeight: 28,
    marginTop: spacing.sm,
  },
  separator: {
    height: spacing.sm,
  },
});
