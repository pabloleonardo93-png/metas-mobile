import { useEffect, type PropsWithChildren } from 'react';
import { useRouter, useSegments } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { appRoutes } from '@/config/routes';
import { useAuth } from '@/features/auth/context/AuthContext';
import { getAuthenticatedArea } from '@/features/auth/utils/authRouting';
import { AppButton, AppText, ScreenContainer } from '@/shared/components';
import { colors, spacing } from '@/shared/theme';

function RestoringSession() {
  return (
    <ScreenContainer edges={['top', 'bottom']} style={styles.centered}>
      <ActivityIndicator
        accessibilityLabel="Verificando sessão"
        color={colors.primary}
        size="large"
      />
    </ScreenContainer>
  );
}

function RestoreError() {
  const { clearLocalSession, errorMessage, retryRestore } = useAuth();

  return (
    <ScreenContainer edges={['top', 'bottom']} style={styles.centered}>
      <View style={styles.errorContent}>
        <AppText accessibilityRole="header" variant="title">
          Não foi possível verificar sua sessão
        </AppText>
        <AppText color="textMuted">{errorMessage}</AppText>
        <AppButton label="Tentar novamente" onPress={() => void retryRestore()} />
        <AppButton
          label="Voltar ao acesso"
          variant="secondary"
          onPress={() => void clearLocalSession()}
        />
      </View>
    </ScreenContainer>
  );
}

export function AuthGate({ children }: PropsWithChildren) {
  const router = useRouter();
  const segments = useSegments();
  const { status, user } = useAuth();

  useEffect(() => {
    if (status === 'restoring' || status === 'restore-error') {
      return;
    }

    const routeGroup = segments[0];
    const isAuthRoute = routeGroup === '(auth)';
    const isEmployeeRoute = routeGroup === '(funcionario)';
    const isManagerRoute = routeGroup === '(gestor)';

    if (status === 'unauthenticated') {
      if (!isAuthRoute) {
        router.replace(appRoutes.login);
      }
      return;
    }

    if (user && getAuthenticatedArea(user.role) === 'manager') {
      if (!isManagerRoute) {
        router.replace(appRoutes.managerHome);
      }
      return;
    }

    if (!isEmployeeRoute) {
      router.replace(appRoutes.employeeHome);
    }
  }, [router, segments, status, user]);

  if (status === 'restoring') {
    return <RestoringSession />;
  }
  if (status === 'restore-error') {
    return <RestoreError />;
  }

  return children;
}

const styles = StyleSheet.create({
  centered: {
    alignItems: 'center',
    backgroundColor: colors.background,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  errorContent: {
    gap: spacing.md,
    maxWidth: 420,
    width: '100%',
  },
});
