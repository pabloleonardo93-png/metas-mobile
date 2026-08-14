import { forwardRef, type ComponentRef, type ReactNode, useState } from 'react';
import {
  StyleSheet,
  TextInput,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
  View,
} from 'react-native';

import { AppText } from '@/shared/components/AppText';
import { colors, iconSizes, radius, spacing } from '@/shared/theme';

interface AppTextInputProps extends TextInputProps {
  containerStyle?: StyleProp<ViewStyle>;
  error?: string;
  leftAdornment?: ReactNode;
  rightAdornment?: ReactNode;
}

export const AppTextInput = forwardRef<ComponentRef<typeof TextInput>, AppTextInputProps>(
  function AppTextInput(
    {
      accessibilityHint,
      accessibilityLabel,
      containerStyle,
      error,
      leftAdornment,
      onBlur,
      onFocus,
      placeholderTextColor = colors.textMuted,
      rightAdornment,
      style,
      ...props
    },
    ref,
  ) {
    const [isFocused, setIsFocused] = useState(false);

    return (
      <View style={containerStyle}>
        <View
          style={[
            styles.field,
            isFocused && styles.fieldFocused,
            Boolean(error) && styles.fieldError,
          ]}
        >
          {leftAdornment ? <View style={styles.adornment}>{leftAdornment}</View> : null}
          <TextInput
            ref={ref}
            accessibilityHint={accessibilityHint ?? error}
            accessibilityLabel={accessibilityLabel ?? props.placeholder}
            placeholderTextColor={placeholderTextColor}
            selectionColor={colors.primary}
            style={[styles.input, style]}
            onBlur={(event) => {
              setIsFocused(false);
              onBlur?.(event);
            }}
            onFocus={(event) => {
              setIsFocused(true);
              onFocus?.(event);
            }}
            {...props}
          />
          {rightAdornment ? <View style={styles.adornment}>{rightAdornment}</View> : null}
        </View>
        {error ? (
          <AppText
            accessibilityLiveRegion="polite"
            color="error"
            style={styles.error}
            variant="caption"
          >
            {error}
          </AppText>
        ) : null}
      </View>
    );
  },
);

const styles = StyleSheet.create({
  adornment: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: iconSizes.lg,
    minWidth: iconSizes.lg,
  },
  error: {
    marginLeft: spacing.xs,
    marginTop: spacing.xs,
  },
  field: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 64,
    paddingHorizontal: spacing.md,
  },
  fieldError: {
    borderColor: colors.error,
  },
  fieldFocused: {
    borderColor: colors.focus,
    borderWidth: 2,
  },
  input: {
    color: colors.text,
    flex: 1,
    fontSize: 17,
    minHeight: 56,
    paddingVertical: spacing.sm,
  },
});
