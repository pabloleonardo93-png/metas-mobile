import { type ComponentProps } from 'react';

import { AppText } from '@/shared/components/AppText';
import { AppTextInput } from '@/shared/components/AppTextInput';
import {
  formatCentsForBrlInput,
  parseBrlCurrencyToCents,
  sanitizeBrlCurrencyInput,
} from '@/shared/utils/brlCurrency';

interface BrlCurrencyInputProps extends Omit<
  ComponentProps<typeof AppTextInput>,
  'inputMode' | 'keyboardType' | 'onChangeText' | 'value'
> {
  value: string;
  onChangeText: (value: string) => void;
}

export function BrlCurrencyInput({
  leftAdornment = <AppText color="textMuted">R$</AppText>,
  onBlur,
  onChangeText,
  onFocus,
  value,
  ...props
}: BrlCurrencyInputProps) {
  return (
    <AppTextInput
      {...props}
      inputMode="decimal"
      keyboardType="decimal-pad"
      leftAdornment={leftAdornment}
      value={value}
      onBlur={(event) => {
        const cents = parseBrlCurrencyToCents(value);

        if (cents !== null) {
          onChangeText(formatCentsForBrlInput(cents));
        }

        onBlur?.(event);
      }}
      onChangeText={(nextValue) => onChangeText(sanitizeBrlCurrencyInput(nextValue))}
      onFocus={(event) => {
        const cents = parseBrlCurrencyToCents(value);

        if (cents !== null) {
          onChangeText(formatCentsForBrlInput(cents, false));
        }

        onFocus?.(event);
      }}
    />
  );
}
