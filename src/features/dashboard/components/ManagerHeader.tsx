import { StyleSheet, View } from 'react-native';

import { AppText } from '@/shared/components';
import { colors, radius, spacing } from '@/shared/theme';
import { getInitials } from '@/shared/utils/getInitials';

interface ManagerHeaderProps {
  name: string;
}

export function ManagerHeader({ name }: ManagerHeaderProps) {
  return (
    <View style={styles.container}>
      <View style={styles.copy}>
        <AppText accessibilityRole="header" style={styles.title} variant="title">
          Olá, {name}
        </AppText>
        <AppText color="textMuted">Visão geral da loja</AppText>
      </View>

      <View accessible accessibilityLabel={`Avatar de ${name}`} style={styles.avatar}>
        <AppText color="primary" variant="bodyMedium">
          {getInitials(name)}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    alignItems: 'center',
    backgroundColor: colors.primarySubtle,
    borderColor: colors.border,
    borderRadius: radius.pill,
    borderWidth: 1,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  container: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  copy: {
    flex: 1,
    gap: spacing.xs,
  },
  title: {
    letterSpacing: 0,
  },
});
