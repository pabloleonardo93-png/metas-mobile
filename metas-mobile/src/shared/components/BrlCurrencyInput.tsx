import { type ComponentProps } from 'react';

import { AppText } from '@/shared/components/AppText';
import { AppTextInput } from '@/shared/components/AppTextInput';
import { sanitizeBrlCurrencyInput } from '@/shared/utils/brlCurrency';

interface BrlCurrencyInputProps extends Omit<
  ComponentProps<typeof AppTextInput>,
  'inputMode' | 'keyboardType' | 'onChangeText' | 'value'
> {
  value: string;
  onChangeText: (value: string) => void;
}

export function BrlCurrencyInput({
  leftAdornment = <AppText color="textMuted">R$</AppText>,
  onChangeText,
  value,
  ...props
}: BrlCurrencyInputProps) {
  return (
    <AppTextInput
      {...props}
      inputMode="numeric"
      keyboardType="number-pad"
      leftAdornment={leftAdornment}
      value={value}
      onChangeText={(nextValue) => {
        const formattedValue = sanitizeBrlCurrencyInput(nextValue);
        if (formattedValue) onChangeText(formattedValue);
      }}
    />
  );
}
