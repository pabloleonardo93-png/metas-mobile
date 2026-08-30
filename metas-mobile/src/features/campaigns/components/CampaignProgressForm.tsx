import { useMemo, useRef, useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';

import type { CampaignProgressInput } from '@/features/campaigns/types/campaign.types';
import { AppButton, AppIcon, AppText, AppTextInput, BrlCurrencyInput } from '@/shared/components';
import { colors, radius, shadows, spacing } from '@/shared/theme';
import { parseBrlCurrencyToCents } from '@/shared/utils/brlCurrency';

interface CampaignProgressFormProps {
  allowsQuantity: boolean;
  onSubmit: (input: CampaignProgressInput) => Promise<void>;
}

export function CampaignProgressForm({ allowsQuantity, onSubmit }: CampaignProgressFormProps) {
  const [amount, setAmount] = useState('');
  const [includeQuantity, setIncludeQuantity] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [quantity, setQuantity] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const submissionLockRef = useRef(false);
  const amountCents = parseBrlCurrencyToCents(amount);
  const errors = useMemo(() => {
    const next: { amount?: string; quantity?: string } = {};
    if (!amount.trim()) {
      next.amount = 'Informe o valor vendido.';
    } else if (amountCents === null || amountCents <= 0) {
      next.amount = 'Informe um valor vendido maior que zero.';
    }
    if (allowsQuantity && includeQuantity) {
      const parsedQuantity = Number(quantity);
      if (!quantity.trim()) {
        next.quantity = 'Informe a quantidade vendida.';
      } else if (!/^\d+$/.test(quantity) || !Number.isInteger(parsedQuantity)) {
        next.quantity = 'Use somente números inteiros.';
      } else if (parsedQuantity <= 0) {
        next.quantity = 'A quantidade deve ser maior que zero.';
      } else if (parsedQuantity > 1_000_000_000) {
        next.quantity = 'A quantidade informada é muito alta.';
      }
    }
    return next;
  }, [allowsQuantity, amount, amountCents, includeQuantity, quantity]);

  async function handleSubmit() {
    if (submissionLockRef.current) return;
    setSubmitted(true);
    if (Object.keys(errors).length > 0 || amountCents === null) return;

    submissionLockRef.current = true;
    setIsSubmitting(true);
    try {
      await onSubmit({
        amountCents,
        quantity: allowsQuantity && includeQuantity ? Number(quantity) : null,
      });
      setAmount('');
      setIncludeQuantity(false);
      setQuantity('');
      setSubmitted(false);
    } finally {
      submissionLockRef.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    <View style={styles.card}>
      <View style={styles.heading}>
        <AppText accessibilityRole="header" variant="title">
          Registrar progresso
        </AppText>
        <AppText color="textMuted" variant="caption">
          Cada lançamento fica registrado no histórico da campanha.
        </AppText>
      </View>

      <View style={styles.field}>
        <AppText variant="label">Valor vendido</AppText>
        <BrlCurrencyInput
          accessibilityLabel="Valor vendido da campanha"
          editable={!isSubmitting}
          error={submitted ? errors.amount : undefined}
          placeholder="500,00"
          value={amount}
          onChangeText={setAmount}
        />
      </View>

      {allowsQuantity ? (
        <View style={[styles.quantityControl, includeQuantity && styles.quantityControlEnabled]}>
          <View style={styles.quantityControlCopy}>
            <AppText variant="bodyMedium">Informar quantidade vendida</AppText>
            <AppText color="textMuted" variant="caption">
              Opcional neste lançamento.
            </AppText>
          </View>
          <Switch
            accessibilityLabel="Informar quantidade vendida"
            accessibilityState={{ checked: includeQuantity }}
            disabled={isSubmitting}
            ios_backgroundColor={colors.disabled}
            thumbColor={colors.surface}
            trackColor={{ false: colors.disabled, true: colors.primary }}
            value={includeQuantity}
            onValueChange={(value) => {
              setIncludeQuantity(value);
              if (!value) setQuantity('');
            }}
          />
        </View>
      ) : null}

      {allowsQuantity && includeQuantity ? (
        <View style={styles.field}>
          <AppText variant="label">Quantidade vendida</AppText>
          <AppTextInput
            accessibilityLabel="Quantidade vendida neste lançamento"
            editable={!isSubmitting}
            error={submitted ? errors.quantity : undefined}
            inputMode="numeric"
            keyboardType="number-pad"
            leftAdornment={<AppIcon color={colors.textMuted} name="target" size={22} />}
            placeholder="10"
            value={quantity}
            onChangeText={setQuantity}
          />
        </View>
      ) : null}

      <AppButton label="Registrar progresso" loading={isSubmitting} onPress={handleSubmit} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    ...shadows.card,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.lg,
    padding: spacing.md,
  },
  field: {
    gap: spacing.sm,
  },
  heading: {
    gap: spacing.xs,
  },
  quantityControl: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
    padding: spacing.md,
  },
  quantityControlCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  quantityControlEnabled: {
    backgroundColor: colors.primarySubtle,
    borderColor: colors.primary,
  },
});
