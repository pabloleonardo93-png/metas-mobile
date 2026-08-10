import { useState } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { EmployeeBottomNavigation } from '@/features/dashboard/components/EmployeeBottomNavigation';
import { EmployeeHeader } from '@/features/dashboard/components/EmployeeHeader';
import {
  GoalRegistrationForm,
  type RegisteredGoal,
} from '@/features/dashboard/components/GoalRegistrationForm';
import { MainGoalCard } from '@/features/dashboard/components/MainGoalCard';
import { PerformanceSummary } from '@/features/dashboard/components/PerformanceSummary';
import { PriorityGoalCard } from '@/features/dashboard/components/PriorityGoalCard';
import { employeeDashboardMock } from '@/features/dashboard/mocks/employeeDashboard.mock';
import type { MonetaryGoal, PriorityGoal } from '@/features/dashboard/types/employeeDashboard';
import { AppButton, AppText, ScreenContainer } from '@/shared/components';
import { colors, spacing } from '@/shared/theme';

export function EmployeeHomeScreen() {
  const { width } = useWindowDimensions();
  const horizontalPadding = Math.max(spacing.lg, (width - 680) / 2);
  const [isRegistrationOpen, setIsRegistrationOpen] = useState(false);
  const [employeeRole, setEmployeeRole] = useState('Vendedor');
  const [monthlyGoal, setMonthlyGoal] = useState<MonetaryGoal>(employeeDashboardMock.metaMensal);
  const [priorityGoals, setPriorityGoals] = useState<PriorityGoal[]>(
    employeeDashboardMock.metasPrioritarias,
  );

  function handleGoalSave(goal: RegisteredGoal) {
    setEmployeeRole(goal.employeeRole);
    setMonthlyGoal({ objetivo: goal.targetValue, realizado: goal.soldValue });
    setPriorityGoals((currentGoals) => [
      {
        id: `${Date.now()}`,
        objetivo: goal.targetValue,
        produto: goal.product,
        realizado: goal.soldValue,
        unidade: 'reais',
      },
      ...currentGoals,
    ]);
    setIsRegistrationOpen(false);
  }

  return (
    <ScreenContainer edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingHorizontal: horizontalPadding }]}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <EmployeeHeader name={employeeDashboardMock.usuario.nome} />

        <AppText color="textMuted" variant="caption">
          Funcao: {employeeRole}
        </AppText>

        <MainGoalCard goal={monthlyGoal} />

        {!isRegistrationOpen ? (
          <AppButton label="Cadastrar produto e meta" onPress={() => setIsRegistrationOpen(true)} />
        ) : null}

        {isRegistrationOpen ? (
          <GoalRegistrationForm
            onCancel={() => setIsRegistrationOpen(false)}
            onSave={handleGoalSave}
          />
        ) : null}

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <AppText accessibilityRole="header" variant="title">
              Metas prioritarias
            </AppText>
          </View>

          <View style={styles.goalList}>
            {priorityGoals.map((goal) => (
              <PriorityGoalCard key={goal.id} goal={goal} />
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <AppText accessibilityRole="header" variant="title">
            Resumo do desempenho
          </AppText>
          <PerformanceSummary summary={employeeDashboardMock.resumo} />
        </View>
      </ScrollView>

      <EmployeeBottomNavigation />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  goalList: {
    gap: spacing.md,
  },
  scrollContent: {
    backgroundColor: colors.background,
    flexGrow: 1,
    gap: spacing.lg,
    paddingBottom: spacing.xl,
    paddingVertical: spacing.lg,
  },
  section: {
    gap: spacing.md,
  },
  sectionHeader: {
    gap: spacing.md,
  },
});
