import { Link } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { appRoutes } from '@/config/routes';
import { AppButton, AppText, ScreenContainer } from '@/shared/components';
import { spacing } from '@/shared/theme';

export function EmployeeHomeScreen() {
  return (
    <ScreenContainer edges={['top', 'bottom']}>
      <View style={styles.content}>
        <AppText variant="title">Início do funcionário</AppText>
        <AppText color="textMuted">
          Esta é uma tela provisória para confirmar a rota do perfil de funcionário.
        </AppText>
        <Link asChild href={appRoutes.root}>
          <AppButton label="Voltar à entrada" variant="secondary" />
        </Link>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    gap: spacing.md,
    justifyContent: 'center',
    padding: spacing.lg,
  },
});
