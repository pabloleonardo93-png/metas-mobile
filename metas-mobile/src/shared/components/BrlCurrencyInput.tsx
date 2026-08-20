import type { ComponentProps } from 'react';

import { AppText } from '@/shared/components/AppText';
import { AppTextInput } from '@/shared/components/AppTextInput';
import {
  isEditableBrlCurrencyInput,
  normalizeBrlCurrencyInput,
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
  value,
  ...props
}: BrlCurrencyInputProps) {
  return (
    <AppTextInput
      {...props}
      inputMode="decimal"
      keyboardType="numeric"
      leftAdornment={leftAdornment}
      value={value}
      onBlur={(event) => {
        const formattedValue = normalizeBrlCurrencyInput(value);
        if (formattedValue && formattedValue !== value) {
          onChangeText(formattedValue);
        }
        onBlur?.(event);
      }}
      onChangeText={(nextValue) => {
        const sanitizedValue = sanitizeBrlCurrencyInput(nextValue);
        if (isEditableBrlCurrencyInput(sanitizedValue)) {
          onChangeText(sanitizedValue);
        }
      }}
    />
  );
}
