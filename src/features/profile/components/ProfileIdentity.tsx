import { StyleSheet, View } from 'react-native';

import { EmployeeAvatar } from '@/features/employees/components/EmployeeAvatar';
import { AppText } from '@/shared/components';
import { spacing } from '@/shared/theme';

interface ProfileIdentityProps {
  name: string;
}

export function ProfileIdentity({ name }: ProfileIdentityProps) {
  return (
    <View accessible accessibilityLabel={`Perfil de ${name}`} style={styles.container}>
      <EmployeeAvatar name={name} size="large" />
      <AppText accessibilityRole="header" style={styles.name} variant="title">
        {name}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  name: {
    letterSpacing: 0,
    textAlign: 'center',
  },
});
