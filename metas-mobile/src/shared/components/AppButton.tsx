import { forwardRef, type ComponentRef, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  type PressableProps,
  type PressableStateCallbackType,
  View,
} from 'react-native';

import { AppText } from '@/shared/components/AppText';
import { colors, radius, spacing } from '@/shared/theme';

type AppButtonVariant = 'primary' | 'secondary';

interface AppButtonProps extends Omit<PressableProps, 'children'> {
  fullWidth?: boolean;
  label: string;
  leftIcon?: ReactNode;
  loading?: boolean;
  variant?: AppButtonVariant;
}

export const AppButton = forwardRef<ComponentRef<typeof Pressable>, AppButtonProps>(
  function AppButton(
    {
      accessibilityLabel,
      disabled = false,
      fullWidth = true,
      label,
      leftIcon,
      loading = false,
      style,
      variant = 'primary',
      ...props
    },
    ref,
  ) {
    const isDisabled = disabled || loading;

    const resolveStyle = (state: PressableStateCallbackType) => {
      const customStyle = typeof style === 'function' ? style(state) : style;

      return [
        styles.base,
        fullWidth && styles.fullWidth,
        variant === 'primary' ? styles.primary : styles.secondary,
        state.pressed && (variant === 'primary' ? styles.primaryPressed : styles.secondaryPressed),
        isDisabled && styles.disabled,
        customStyle,
      ];
    };

    return (
      <Pressable
        ref={ref}
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityRole="button"
        accessibilityState={{ busy: loading, disabled: isDisabled }}
        disabled={isDisabled}
        style={resolveStyle}
        {...props}
      >
        {loading ? (
          <ActivityIndicator color={variant === 'primary' ? colors.onPrimary : colors.primary} />
        ) : (
          <View style={styles.content}>
            {leftIcon}
            <AppText
              color={variant === 'primary' ? 'onPrimary' : 'primary'}
              numberOfLines={2}
              style={styles.label}
              variant="button"
            >
              {label}
            </AppText>
          </View>
        )}
      </Pressable>
    );
  },
);

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    borderRadius: radius.md,
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  content: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    maxWidth: '100%',
  },
  disabled: {
    backgroundColor: colors.disabled,
  },
  fullWidth: {
    alignSelf: 'stretch',
  },
  label: {
    flexShrink: 1,
    letterSpacing: 0,
    textAlign: 'center',
  },
  primary: {
    backgroundColor: colors.primary,
  },
  primaryPressed: {
    backgroundColor: colors.primaryPressed,
  },
  secondary: {
    backgroundColor: colors.surface,
    borderColor: colors.primary,
    borderWidth: 1,
  },
  secondaryPressed: {
    backgroundColor: colors.background,
  },
});
