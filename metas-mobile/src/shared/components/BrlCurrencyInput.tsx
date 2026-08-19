import { type ComponentProps, type ComponentRef, useRef } from 'react';

import { AppText } from '@/shared/components/AppText';
import { AppTextInput } from '@/shared/components/AppTextInput';
import {
  formatCentsForBrlInput,
  parseBrlCurrencyToCents,
  sanitizeBrlCurrencyInput,
  shouldPreserveBrlZeroDuringDeletion,
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
  onChangeText,
  onKeyPress,
  value,
  ...props
}: BrlCurrencyInputProps) {
  const inputRef = useRef<ComponentRef<typeof AppTextInput>>(null);
  const zeroValue = formatCentsForBrlInput(0);

  const restoreZeroText = () => {
    inputRef.current?.setNativeProps({ text: zeroValue });
  };

  return (
    <AppTextInput
      ref={inputRef}
      {...props}
      inputMode="numeric"
      keyboardType="number-pad"
      leftAdornment={leftAdornment}
      value={value}
      onChangeText={(nextValue) => {
        if (shouldPreserveBrlZeroDuringDeletion(value, nextValue)) {
          restoreZeroText();
          return;
        }

        const formattedValue = sanitizeBrlCurrencyInput(nextValue);
        if (formattedValue) onChangeText(formattedValue);
      }}
      onKeyPress={(event) => {
        onKeyPress?.(event);
        if (event.nativeEvent.key === 'Backspace' && parseBrlCurrencyToCents(value) === 0) {
          event.preventDefault();
          restoreZeroText();
        }
      }}
    />
  );
}
