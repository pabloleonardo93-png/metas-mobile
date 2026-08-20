import { useMemo } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';

import { appRoutes } from '@/config/routes';
import { EmployeeForm } from '@/features/employees/components/EmployeeForm';
import { EmployeeScreenHeader } from '@/features/employees/components/EmployeeScreenHeader';
import { useEmployees } from '@/features/employees/context/EmployeesContext';
import type { EmployeeFormValues } from '@/features/employees/types/employee.types';
import { ManagerBottomNavigation } from '@/features/dashboard/components/ManagerBottomNavigation';
import { AppButton, AppText, ScreenContainer } from '@/shared/components';
import { colors, spacing } from '@/shared/theme';
import type { UserRole } from '@/shared/types/userRole';
import { formatLocalDateIso } from '@/shared/utils/localDate';

interface EmployeeFormScreenProps {
  mode: 'create' | 'edit';
}

function createNewEmployeeInitialValues(): EmployeeFormValues {
  return {
    email: '',
    joinedAt: formatLocalDateIso(),
    name: '',
    role: '',
    status: 'ATIVO',
  };
}

function getEmployeeId(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

export function EmployeeFormScreen({ mode }: EmployeeFormScreenProps) {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ employeeId?: string | string[] }>();
  const {
    addEmployee,
    changeEmployeeAccessEmail,
    employees,
    errorMessage,
    isLoading,
    refreshEmployees,
    updateEmployee,
  } = useEmployees();
  const employeeId = getEmployeeId(params.employeeId);
  const employee = employees.find((item) => item.id === employeeId);
  const horizontalPadding = Math.max(spacing.md, (width - 680) / 2);
  const initialValues = useMemo<EmployeeFormValues>(() => {
    if (mode === 'edit' && employee) {
      return {
        email: employee.email,
        joinedAt: employee.joinedAt,
        name: employee.name,
        role: employee.role,
        status: employee.status,
      };
    }

    return createNewEmployeeInitialValues();
  }, [employee, mode]);

  if (mode === 'edit' && (isLoading || errorMessage)) {
    return (
      <ScreenContainer edges={['top', 'bottom']}>
        <View style={[styles.notFound, { paddingHorizontal: horizontalPadding }]}>
          <EmployeeScreenHeader title="Editar funcionário" onBack={() => router.back()} />
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

  if (mode === 'edit' && !employee) {
    return (
      <ScreenContainer edges={['top', 'bottom']}>
        <View style={[styles.notFound, { paddingHorizontal: horizontalPadding }]}>
          <EmployeeScreenHeader title="Funcionário não encontrado" onBack={() => router.back()} />
          <AppText color="textMuted">Não foi possível abrir este cadastro para edição.</AppText>
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

  async function handleSubmit(values: EmployeeFormValues & { role: UserRole }) {
    const input = {
      email: values.email,
      joinedAt: values.joinedAt,
      name: values.name,
      role: values.role,
      status: values.status,
    };

    if (mode === 'edit' && employee) {
      await updateEmployee(employee.id, input);
      return;
    }

    await addEmployee(input);
  }

  function handleCreateSuccess() {
    Alert.alert(
      'Cadastro concluído',
      'Funcionário adicionado com sucesso.',
      [{ onPress: () => router.replace(appRoutes.managerTeam), text: 'Voltar para Equipe' }],
      { cancelable: false },
    );
  }

  function confirmAccessEmailChange(): Promise<boolean> {
    return new Promise((resolve) => {
      Alert.alert(
        'Alterar e-mail de acesso',
        'A conta Google atual será desvinculada e todas as sessões desse colaborador serão encerradas.',
        [
          { onPress: () => resolve(false), style: 'cancel', text: 'Cancelar' },
          { onPress: () => resolve(true), style: 'destructive', text: 'Continuar' },
        ],
        { cancelable: false },
      );
    });
  }

  async function handleChangeAccessEmail(email: string) {
    if (!employee || !(await confirmAccessEmailChange())) {
      return null;
    }

    return changeEmployeeAccessEmail(employee.id, { email });
  }

  const title = mode === 'create' ? 'Adicionar funcionário' : 'Editar funcionário';
  const subtitle =
    mode === 'create'
      ? 'Cadastre os dados básicos do colaborador'
      : 'Atualize os dados e o status do colaborador';

  return (
    <ScreenContainer edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardView}
      >
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingHorizontal: horizontalPadding }]}
          contentInsetAdjustmentBehavior="automatic"
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <EmployeeScreenHeader title={title} subtitle={subtitle} onBack={() => router.back()} />
          <EmployeeForm
            googleLinked={mode === 'edit' ? employee?.googleLinked : false}
            initialValues={initialValues}
            submitLabel={mode === 'create' ? 'Adicionar funcionário' : 'Salvar alterações'}
            submitErrorMessage={
              mode === 'create'
                ? 'Não foi possível adicionar o funcionário. Tente novamente.'
                : 'Não foi possível salvar as alterações. Tente novamente.'
            }
            submitSuccessMessage={
              mode === 'create'
                ? 'Funcionário adicionado com sucesso.'
                : 'Funcionário atualizado com sucesso.'
            }
            onChangeAccessEmail={mode === 'edit' ? handleChangeAccessEmail : undefined}
            onSubmit={handleSubmit}
            onSubmitSuccess={mode === 'create' ? handleCreateSuccess : undefined}
          />
        </ScrollView>
      </KeyboardAvoidingView>

      <ManagerBottomNavigation activeTab="team" />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  keyboardView: {
    flex: 1,
  },
  notFound: {
    alignSelf: 'center',
    flex: 1,
    gap: spacing.lg,
    justifyContent: 'center',
    maxWidth: 680,
    width: '100%',
  },
  scrollContent: {
    backgroundColor: colors.background,
    flexGrow: 1,
    gap: spacing.xl,
    paddingBottom: spacing.xl,
    paddingTop: spacing.lg,
  },
});
