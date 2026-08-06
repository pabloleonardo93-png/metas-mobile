import { StyleSheet, View } from 'react-native';

import { AppText, BrandLogo } from '@/shared/components';
import { spacing } from '@/shared/theme';

interface LoginHeaderProps {
  compact?: boolean;
}

export function LoginHeader({ compact = false }: LoginHeaderProps) {
  return (
    <View style={[styles.container, compact && styles.containerCompact]}>
      <BrandLogo size={compact ? 92 : 104} />
      <AppText style={[styles.title, compact && styles.titleCompact]} variant="hero">
        Bem-vindo{`\n`}de volta
      </AppText>
      <AppText color="textMuted" style={styles.subtitle}>
        Acompanhe suas metas e o{`\n`}desempenho da equipe.
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  containerCompact: {
    gap: spacing.xs,
  },
  subtitle: {
    textAlign: 'center',
  },
  title: {
    textAlign: 'center',
  },
  titleCompact: {
    fontSize: 44,
    lineHeight: 52,
  },
});
