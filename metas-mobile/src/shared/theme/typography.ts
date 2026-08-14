import { Platform, type TextStyle } from 'react-native';

export const typography = {
  hero: {
    fontFamily: Platform.select({ android: 'serif', default: 'Georgia', ios: 'Georgia' }),
    fontSize: 48,
    fontWeight: '700',
    letterSpacing: -1.2,
    lineHeight: 56,
  },
  display: {
    fontSize: 32,
    fontWeight: '700',
    letterSpacing: -0.5,
    lineHeight: 40,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: -0.2,
    lineHeight: 32,
  },
  body: {
    fontSize: 16,
    fontWeight: '400',
    lineHeight: 24,
  },
  bodyMedium: {
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 24,
  },
  caption: {
    fontSize: 14,
    fontWeight: '400',
    lineHeight: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
  },
  button: {
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 24,
  },
} satisfies Record<string, TextStyle>;

export type TypographyVariant = keyof typeof typography;
