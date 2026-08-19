import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { appRoutes } from '@/config/routes';
import { useCampaigns } from '@/features/campaigns/context/CampaignsContext';
import { EmployeeAvatar } from '@/features/employees/components/EmployeeAvatar';
import { EmployeeGoalDetails } from '@/features/employees/components/EmployeeGoalDetails';
import { EmployeeScreenHeader } from '@/features/employees/components/EmployeeScreenHeader';
import { EmployeeStatusBadge } from '@/features/employees/components/EmployeeStatusBadge';
import { useEmployees } from '@/features/employees/context/EmployeesContext';
import { formatJoinedDate } from '@/features/employees/utils/employee.utils';
import { ManagerBottomNavigation } from '@/features/dashboard/components/ManagerBottomNavigation';
import { useEmployeeGoal } from '@/features/metas/hooks/useEmployeeGoal';
import { USER_ROLE_LABELS } from '@/shared/config/userRoles';
import { AppButton, AppIcon, AppText, ScreenContainer } from '@/shared/components';
import { colors, radius, shadows, spacing } from '@/shared/theme';

function getEmployeeId(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

export function EmployeeDetailsScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ employeeId?: string | string[] }>();
  const { campaigns } = useCampaigns();
  const { employees, errorMessage, isLoading, refreshEmployees } = useEmployees();
  const employeeId = getEmployeeId(params.employeeId);
  const employee = employees.find((item) => item.id === employeeId);
  const { calculationResult, employeeGoal } = useEmployeeGoal(employee?.role ?? 'GESTOR');
  const horizontalPadding = Math.max(spacing.md, (width - 680) / 2);

  if (isLoading || errorMessage) {
    return (
      <ScreenContainer edges={['top', 'bottom']}>
        <View style={[styles.notFound, { paddingHorizontal: horizontalPadding }]}>
          <EmployeeScreenHeader title="Detalhes do funcionário" onBack={() => router.back()} />
          {isLoading ? (
            <ActivityIndicator color={colors.primary} size="large" />
          ) : (
            <>
              <AppText color="textMuted">{errorMessage}</AppText>
              <AppButton
                label="Tentar novamente"
                variant="secondary"
                onPress={() => void refreshEmployees()}
              />
            </>
          )}
        </View>
        <ManagerBottomNavigation activeTab="team" />
      </ScreenContainer>
    );
  }

  if (!employee) {
    return (
      <ScreenContainer edges={['top', 'bottom']}>
        <View style={[styles.notFound, { paddingHorizontal: horizontalPadding }]}>
          <EmployeeScreenHeader title="Funcionário não encontrado" onBack={() => router.back()} />
          <AppText color="textMuted">
            O cadastro solicitado não está disponível nesta sessão.
          </AppText>
          <AppButton
            label="Voltar para Equipe"
            variant="secondary"
            onPress={() => router.replace(appRoutes.managerTeam)}
          />
        </View>
        <ManagerBottomNavigation activeTab="team" />
      </ScreenContainer>
    );
  }

  const isManager = employee.role === 'GESTOR';
  const employeeRole = employee.role === 'GESTOR' ? null : employee.role;
  const goalStatusMessage =
    calculationResult.status === 'success' && !employeeGoal
      ? 'Este cargo não possui meta individual na distribuição atual.'
      : calculationResult.message;

  return (
    <ScreenContainer edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingHorizontal: horizontalPadding }]}
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
      >
        <EmployeeScreenHeader title="Detalhes do funcionário" onBack={() => router.back()} />

        <View style={styles.profile}>
          <EmployeeAvatar name={employee.name} size="large" />
          <View style={styles.profileCopy}>
            <AppText style={styles.employeeName} variant="title">
              {employee.name}
            </AppText>
            <AppText color="textMuted">{USER_ROLE_LABELS[employee.role].singular}</AppText>
            <EmployeeStatusBadge status={employee.status} />
          </View>
        </View>

        <View style={styles.infoCard}>
          <View style={styles.infoRow}>
            <View style={styles.infoIcon}>
              <AppIcon color={colors.primary} name="mail" size={20} />
            </View>
            <View style={styles.infoCopy}>
              <AppText color="textMuted" variant="caption">
                E-mail
              </AppText>
              <AppText selectable numberOfLines={2} variant="bodyMedium">
                {employee.email}
              </AppText>
            </View>
          </View>
          <View style={[styles.infoRow, styles.infoRowWithDivider]}>
            <View style={styles.infoIcon}>
              <AppIcon color={colors.primary} name="calendar" size={20} />
            </View>
            <View style={styles.infoCopy}>
              <AppText color="textMuted" variant="caption">
                Data de entrada
              </AppText>
              <AppText variant="bodyMedium">{formatJoinedDate(employee.joinedAt)}</AppText>
            </View>
          </View>
        </View>

        {isManager ? (
          <View style={styles.managerNotice}>
            <AppIcon color={colors.primary} name="settings" size={22} />
            <View style={styles.infoCopy}>
              <AppText variant="bodyMedium">Acesso administrativo</AppText>
              <AppText color="textMuted" variant="caption">
                Gestores não participam da meta individual de vendas.
              </AppText>
            </View>
          </View>
        ) : employee.performance && employeeRole ? (
          <EmployeeGoalDetails
            campaigns={campaigns}
            financialGoal={employeeGoal}
            performance={employee.performance}
            role={employeeRole}
            statusMessage={goalStatusMessage}
          />
        ) : (
          <View style={styles.managerNotice}>
            <AppIcon color={colors.textMuted} name="target" size={22} />
            <AppText color="textMuted">Nenhum desempenho individual disponível.</AppText>
          </View>
        )}

        <AppButton
          label="Editar funcionário"
          leftIcon={<AppIcon color={colors.onPrimary} name="edit" size={22} />}
          onPress={() => router.push(appRoutes.managerEditEmployee(employee.id))}
        />
      </ScrollView>

      <ManagerBottomNavigation activeTab="team" />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  employeeName: {
    letterSpacing: 0,
  },
  infoCard: {
    ...shadows.panel,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  infoCopy: {
    flex: 1,
    gap: spacing.xs,
    minWidth: 0,
  },
  infoIcon: {
    alignItems: 'center',
    backgroundColor: colors.primarySubtle,
    borderRadius: radius.sm,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  infoRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 76,
    padding: spacing.md,
  },
  infoRowWithDivider: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
  },
  managerNotice: {
    ...shadows.panel,
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
  },
  notFound: {
    alignSelf: 'center',
    flex: 1,
    gap: spacing.lg,
    justifyContent: 'center',
    maxWidth: 680,
    width: '100%',
  },
  profile: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.lg,
  },
  profileCopy: {
    flex: 1,
    gap: spacing.xs,
    minWidth: 0,
  },
  scrollContent: {
    backgroundColor: colors.background,
    flexGrow: 1,
    gap: spacing.lg,
    paddingBottom: spacing.xl,
    paddingTop: spacing.lg,
  },
});
