import { StyleSheet, View } from 'react-native';

import { AppText } from '@/shared/components';
import { colors, radius } from '@/shared/theme';
import { getInitials } from '@/shared/utils/getInitials';

interface EmployeeAvatarProps {
  name: string;
  size?: 'large' | 'regular';
}

export function EmployeeAvatar({ name, size = 'regular' }: EmployeeAvatarProps) {
  const isLarge = size === 'large';

  return (
    <View
      accessible
      accessibilityLabel={`Avatar de ${name}`}
      style={[styles.avatar, isLarge && styles.avatarLarge]}
    >
      <AppText color="primary" style={isLarge ? styles.textLarge : undefined} variant="bodyMedium">
        {getInitials(name)}
      </AppText>
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
  avatarLarge: {
    height: 80,
    width: 80,
  },
  textLarge: {
    fontSize: 24,
    letterSpacing: 0,
    lineHeight: 32,
  },
});
