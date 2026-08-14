import type { PropsWithChildren } from 'react';
import { StyleSheet, Text, type TextProps } from 'react-native';

import { colors, type ColorToken, typography, type TypographyVariant } from '@/shared/theme';

interface AppTextProps extends PropsWithChildren<TextProps> {
  color?: ColorToken;
  variant?: TypographyVariant;
}

export function AppText({
  children,
  color = 'text',
  style,
  variant = 'body',
  ...props
}: AppTextProps) {
  return (
    <Text style={[styles.base, typography[variant], { color: colors[color] }, style]} {...props}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  base: {
    includeFontPadding: false,
  },
});
