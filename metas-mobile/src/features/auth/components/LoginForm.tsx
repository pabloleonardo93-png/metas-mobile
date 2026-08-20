import { Platform, StyleSheet, View } from 'react-native';

import { useAuth } from '@/features/auth/context/AuthContext';
import { AppButton, AppText } from '@/shared/components';
import { colors, radius, spacing } from '@/shared/theme';

function GoogleMark() {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.googleMark}
    >
      <AppText style={styles.googleLetter} variant="label">
        G
      </AppText>
    </View>
  );
}

export function LoginForm() {
  const { isAuthenticating, loginWithGoogle } = useAuth();
  const isWeb = Platform.OS === 'web';

  return (
    <View style={styles.form}>
      <AppButton
        accessibilityHint="Abre o seletor de conta Google"
        disabled={isWeb}
        label={isWeb ? 'Google indisponível na web' : 'Continuar com Google'}
        leftIcon={<GoogleMark />}
        loading={isAuthenticating}
        variant="secondary"
        onPress={() => void loginWithGoogle()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  form: {
    gap: spacing.md,
  },
  googleLetter: {
    color: '#4285F4',
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 20,
  },
  googleMark: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.pill,
    borderWidth: 1,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
});
