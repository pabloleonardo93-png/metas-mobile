import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { appRoutes } from '@/config/routes';
import { useAuthenticatedEmployee } from '@/features/auth/context/AuthContext';
import { useCampaigns } from '@/features/campaigns/context/CampaignsContext';
import { selectActiveCampaigns } from '@/features/campaigns/utils/campaign.utils';
import { EmployeeBottomNavigation } from '@/features/dashboard/components/EmployeeBottomNavigation';
import { EmployeeCampaignsSection } from '@/features/dashboard/components/EmployeeCampaignsSection';
import { EmployeeHeader } from '@/features/dashboard/components/EmployeeHeader';
import { EmployeeFinancialGoalCard } from '@/features/metas/components/EmployeeFinancialGoalCard';
import { useEmployeeGoal } from '@/features/metas/hooks/useEmployeeGoal';
import { USER_ROLE_LABELS } from '@/shared/config/userRoles';
import { AppText, ScreenContainer } from '@/shared/components';
import { colors, radius, spacing } from '@/shared/theme';

export function EmployeeHomeScreen() {
  const currentEmployee = useAuthenticatedEmployee();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { campaigns } = useCampaigns();
  const { calculationResult, employeeGoal } = useEmployeeGoal(currentEmployee.role);
  const horizontalPadding = Math.max(spacing.lg, (width - 680) / 2);
  const employeeRole = USER_ROLE_LABELS[currentEmployee.role].singular;
  const activeCampaigns = selectActiveCampaigns(campaigns).slice(0, 2);
  const goalStatusMessage =
    calculationResult.status === 'success' && !employeeGoal
      ? 'Seu cargo não possui meta individual na distribuição atual.'
      : calculationResult.message;

  return (
    <ScreenContainer edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingHorizontal: horizontalPadding }]}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <EmployeeHeader name={currentEmployee.name} />

        <AppText color="textMuted" variant="caption">
          Função: {employeeRole}
        </AppText>

        <EmployeeFinancialGoalCard
          compact
          goal={employeeGoal}
          role={currentEmployee.role}
          statusMessage={goalStatusMessage}
          onSeeDetails={() => router.push(appRoutes.employeeGoals)}
        />

        <EmployeeCampaignsSection campaigns={activeCampaigns} contributions={[]} />

        <View style={styles.section}>
          <AppText accessibilityRole="header" variant="title">
            Resumo do desempenho
          </AppText>
          <View style={styles.emptyState}>
            <AppText color="textMuted" variant="bodyMedium">
              Nenhum resultado disponível
            </AppText>
          </View>
        </View>
      </ScrollView>

      <EmployeeBottomNavigation activeTab="home" />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  emptyState: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.md,
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
});
