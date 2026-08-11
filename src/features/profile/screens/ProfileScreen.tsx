import type { ReactNode } from 'react';
import { useRouter } from 'expo-router';
import { Alert, ScrollView, StyleSheet, useWindowDimensions } from 'react-native';

import { appRoutes } from '@/config/routes';
import type { Employee } from '@/features/employees/types/employee.types';
import { ProfileAccountSection } from '@/features/profile/components/ProfileAccountSection';
import { ProfileIdentity } from '@/features/profile/components/ProfileIdentity';
import { ProfileInfoSection } from '@/features/profile/components/ProfileInfoSection';
import { ScreenContainer } from '@/shared/components';
import { colors, spacing } from '@/shared/theme';

type ProfileUser = Pick<Employee, 'email' | 'joinedAt' | 'name' | 'status'>;

interface ProfileScreenProps {
  bottomNavigation: ReactNode;
  user: ProfileUser;
}

export function ProfileScreen({ bottomNavigation, user }: ProfileScreenProps) {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const horizontalPadding = Math.max(spacing.md, (width - 680) / 2);

  function showComingSoon(title: string) {
    Alert.alert(title, 'Esta opção será disponibilizada em uma próxima etapa.');
  }

  function confirmLogout() {
    Alert.alert('Deseja sair?', 'Você voltará para a tela de acesso.', [
      { style: 'cancel', text: 'Cancelar' },
      {
        style: 'destructive',
        text: 'Sair',
        onPress: () => router.replace(appRoutes.login),
      },
    ]);
  }

  return (
    <ScreenContainer edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingHorizontal: horizontalPadding }]}
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
      >
        <ProfileIdentity name={user.name} />

        <ProfileInfoSection email={user.email} joinedAt={user.joinedAt} status={user.status} />

        <ProfileAccountSection
          onLogout={confirmLogout}
          onNotifications={() => showComingSoon('Notificações')}
          onPrivacy={() => showComingSoon('Privacidade')}
        />
      </ScrollView>

      {bottomNavigation}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    backgroundColor: colors.background,
    flexGrow: 1,
    gap: spacing.xl,
    paddingBottom: spacing.xl,
    paddingTop: spacing.lg,
  },
});
