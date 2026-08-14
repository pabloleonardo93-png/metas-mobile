import { StyleSheet, View } from 'react-native';

import { AppText, AppTextInput } from '@/shared/components';
import { spacing } from '@/shared/theme';

interface BusinessDaysFieldsProps {
  remainingError?: string;
  remainingValue: string;
  totalError?: string;
  totalValue: string;
  onRemainingChange: (value: string) => void;
  onTotalChange: (value: string) => void;
}

function sanitizePositiveInteger(value: string): string {
  return value.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
}

export function BusinessDaysFields({
  remainingError,
  remainingValue,
  totalError,
  totalValue,
  onRemainingChange,
  onTotalChange,
}: BusinessDaysFieldsProps) {
  return (
    <View style={styles.group}>
      <AppText variant="label">Dias Úteis Restantes / Total</AppText>

      <View style={styles.row}>
        <View style={styles.fieldColumn}>
          <AppText color="textMuted" variant="caption">
            Restantes
          </AppText>
          <AppTextInput
            accessibilityLabel="Dias úteis restantes"
            error={remainingError}
            inputMode="numeric"
            keyboardType="number-pad"
            maxLength={3}
            placeholder="20"
            returnKeyType="next"
            value={remainingValue}
            onChangeText={(value) => onRemainingChange(sanitizePositiveInteger(value))}
          />
        </View>

        <AppText accessibilityElementsHidden style={styles.separator} variant="title">
          /
        </AppText>

        <View style={styles.fieldColumn}>
          <AppText color="textMuted" variant="caption">
            Total do mês
          </AppText>
          <AppTextInput
            accessibilityLabel="Total de dias úteis do mês"
            error={totalError}
            inputMode="numeric"
            keyboardType="number-pad"
            maxLength={3}
            placeholder="26"
            returnKeyType="done"
            value={totalValue}
            onChangeText={(value) => onTotalChange(sanitizePositiveInteger(value))}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fieldColumn: {
    flex: 1,
    gap: spacing.xs,
    minWidth: 0,
  },
  group: {
    gap: spacing.sm,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  separator: {
    marginTop: spacing.lg,
  },
});
