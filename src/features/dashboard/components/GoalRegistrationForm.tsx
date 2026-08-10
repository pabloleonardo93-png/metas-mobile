import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { formatBrazilianCurrency } from '@/features/dashboard/utils/formatters';
import { AppButton, AppText, AppTextInput } from '@/shared/components';
import { colors, radius, shadows, spacing } from '@/shared/theme';

export interface RegisteredGoal {
  employeeRole: string;
  product: string;
  soldValue: number;
  targetValue: number;
}

interface GoalRegistrationFormProps {
  onCancel: () => void;
  onSave: (goal: RegisteredGoal) => void;
}

function parseCurrency(value: string): number {
  const compactValue = value.trim().replace(/\s/g, '');
  const normalizedValue = compactValue.includes(',')
    ? compactValue.replace(/\./g, '').replace(',', '.')
    : compactValue;

  return Number(normalizedValue);
}

export function GoalRegistrationForm({ onCancel, onSave }: GoalRegistrationFormProps) {
  const [employeeRole, setEmployeeRole] = useState('Vendedor');
  const [product, setProduct] = useState('');
  const [soldValue, setSoldValue] = useState('0');
  const [targetValue, setTargetValue] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const targetNumber = useMemo(() => parseCurrency(targetValue), [targetValue]);
  const soldNumber = useMemo(() => parseCurrency(soldValue), [soldValue]);
  const remainingValue = Math.max(
    0,
    (Number.isFinite(targetNumber) ? targetNumber : 0) -
      (Number.isFinite(soldNumber) ? soldNumber : 0),
  );

  const productIsInvalid = !product.trim();
  const roleIsInvalid = !employeeRole.trim();
  const targetIsInvalid = !Number.isFinite(targetNumber) || targetNumber <= 0;
  const soldIsInvalid = !Number.isFinite(soldNumber) || soldNumber < 0 || soldNumber > targetNumber;
  const productError = submitted && productIsInvalid ? 'Informe o produto.' : undefined;
  const roleError = submitted && roleIsInvalid ? 'Informe a funcao.' : undefined;
  const targetError = submitted && targetIsInvalid ? 'Informe uma meta maior que zero.' : undefined;
  const soldError =
    submitted && soldIsInvalid ? 'O valor vendido deve ficar entre R$ 0 e a meta.' : undefined;

  function handleSave() {
    setSubmitted(true);

    if (productIsInvalid || roleIsInvalid || targetIsInvalid || soldIsInvalid) {
      return;
    }

    onSave({
      employeeRole: employeeRole.trim(),
      product: product.trim(),
      soldValue: soldNumber,
      targetValue: targetNumber,
    });
  }

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.copy}>
          <AppText accessibilityRole="header" variant="title">
            Nova meta de venda
          </AppText>
          <AppText color="textMuted" variant="caption">
            Cadastre o produto e acompanhe o saldo necessario para bater a meta.
          </AppText>
        </View>
        <Pressable
          accessibilityLabel="Fechar cadastro de meta"
          accessibilityRole="button"
          hitSlop={spacing.sm}
          style={({ pressed }) => [styles.closeButton, pressed && styles.closeButtonPressed]}
          onPress={onCancel}
        >
          <AppText color="primary" variant="label">
            Fechar
          </AppText>
        </Pressable>
      </View>

      <AppTextInput
        error={productError}
        placeholder="Produto"
        returnKeyType="next"
        value={product}
        onChangeText={setProduct}
      />
      <AppTextInput
        error={roleError}
        placeholder="Funcao do funcionario"
        returnKeyType="next"
        value={employeeRole}
        onChangeText={setEmployeeRole}
      />
      <AppTextInput
        error={targetError}
        inputMode="decimal"
        keyboardType="decimal-pad"
        placeholder="Valor da meta (R$)"
        returnKeyType="next"
        value={targetValue}
        onChangeText={setTargetValue}
      />
      <AppTextInput
        error={soldError}
        inputMode="decimal"
        keyboardType="decimal-pad"
        placeholder="Valor ja vendido (R$)"
        returnKeyType="done"
        value={soldValue}
        onChangeText={setSoldValue}
        onSubmitEditing={handleSave}
      />

      <View accessibilityLiveRegion="polite" style={styles.remainingBox}>
        <AppText color="textMuted" variant="label">
          Ainda precisa vender
        </AppText>
        <AppText color="primary" variant="display">
          {formatBrazilianCurrency(remainingValue)}
        </AppText>
      </View>

      <AppButton label="Salvar meta" onPress={handleSave} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    ...shadows.panel,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.md,
  },
  closeButton: {
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.xs,
  },
  closeButtonPressed: {
    opacity: 0.6,
  },
  copy: {
    flex: 1,
    gap: spacing.xs,
  },
  header: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  remainingBox: {
    backgroundColor: colors.primarySubtle,
    borderRadius: radius.md,
    gap: spacing.xs,
    padding: spacing.md,
  },
});
