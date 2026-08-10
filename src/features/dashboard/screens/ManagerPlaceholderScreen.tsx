import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { appRoutes } from '@/config/routes';
import {
  ManagerBottomNavigation,
  type ManagerTab,
} from '@/features/dashboard/components/ManagerBottomNavigation';
import { AppButton, AppText, ScreenContainer } from '@/shared/components';
import { spacing } from '@/shared/theme';

interface ManagerPlaceholderScreenProps {
  activeTab: Exclude<ManagerTab, 'home'>;
  title: string;
}

export function ManagerPlaceholderScreen({ activeTab, title }: ManagerPlaceholderScreenProps) {
  const router = useRouter();

  return (
    <ScreenContainer edges={['top', 'bottom']}>
      <View style={styles.content}>
        <AppText accessibilityRole="header" variant="title">
          {title}
        </AppText>
        <AppText color="textMuted">
          Esta área está preparada para uma próxima etapa do frontend.
        </AppText>
        <AppButton
          label="Voltar ao início"
          variant="secondary"
          onPress={() => router.replace(appRoutes.managerHome)}
        />
      </View>

      <ManagerBottomNavigation activeTab={activeTab} />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: {
    alignSelf: 'center',
    flex: 1,
    gap: spacing.md,
    justifyContent: 'center',
    maxWidth: 680,
    padding: spacing.lg,
    width: '100%',
  },
});
