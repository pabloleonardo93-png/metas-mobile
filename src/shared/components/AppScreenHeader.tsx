import { Pressable, StyleSheet, View } from 'react-native';

import { AppIcon } from '@/shared/components/AppIcon';
import { AppText } from '@/shared/components/AppText';
import { colors, radius, spacing } from '@/shared/theme';

interface AppScreenHeaderProps {
  onBack?: () => void;
  subtitle?: string;
  title: string;
}

export function AppScreenHeader({ onBack, subtitle, title }: AppScreenHeaderProps) {
  return (
    <View style={styles.container}>
      {onBack ? (
        <Pressable
          accessibilityLabel="Voltar"
          accessibilityRole="button"
          hitSlop={spacing.sm}
          style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
          onPress={onBack}
        >
          <AppIcon color={colors.text} name="arrow-left" size={24} />
        </Pressable>
      ) : null}

      <View style={styles.copy}>
        <AppText accessibilityRole="header" style={styles.title} variant="title">
          {title}
        </AppText>
        {subtitle ? <AppText color="textMuted">{subtitle}</AppText> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backButton: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.pill,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  backButtonPressed: {
    backgroundColor: colors.primarySubtle,
  },
  container: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  copy: {
    flex: 1,
    gap: spacing.xs,
  },
  title: {
    letterSpacing: 0,
  },
});
