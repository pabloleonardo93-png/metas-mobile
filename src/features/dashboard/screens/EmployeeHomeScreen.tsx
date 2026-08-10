import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { EmployeeBottomNavigation } from '@/features/dashboard/components/EmployeeBottomNavigation';
import { EmployeeHeader } from '@/features/dashboard/components/EmployeeHeader';
import { MainGoalCard } from '@/features/dashboard/components/MainGoalCard';
import { PerformanceSummary } from '@/features/dashboard/components/PerformanceSummary';
import { StoreCampaignCard } from '@/features/dashboard/components/StoreCampaignCard';
import { employeeDashboardMock } from '@/features/dashboard/mocks/employeeDashboard.mock';
import { USER_ROLE_LABELS } from '@/shared/config/userRoles';
import { AppText, ScreenContainer } from '@/shared/components';
import { colors, spacing } from '@/shared/theme';

export function EmployeeHomeScreen() {
  const { width } = useWindowDimensions();
  const horizontalPadding = Math.max(spacing.lg, (width - 680) / 2);
  const employeeRole = USER_ROLE_LABELS[employeeDashboardMock.usuario.cargo].singular;

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
          Função: {employeeRole}
        </AppText>

        <MainGoalCard goal={employeeDashboardMock.metaMensal} />

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <AppText accessibilityRole="header" variant="title">
              Campanhas em foco
            </AppText>
          </View>

          <View style={styles.goalList}>
            {employeeDashboardMock.activeStoreCampaigns.map((campaign) => (
              <StoreCampaignCard key={campaign.id} campaign={campaign} />
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
