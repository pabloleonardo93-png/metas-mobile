import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { CampaignFormValues, CampaignInput } from '@/features/campaigns/types/campaign.types';
import {
  formatBrazilianDateInput,
  parseBrazilianDate,
} from '@/features/campaigns/utils/campaignDates';
import { validateCampaignForm } from '@/features/campaigns/utils/validateCampaignForm';
import { AppButton, AppIcon, AppText, AppTextInput, BrlCurrencyInput } from '@/shared/components';
import { colors, spacing } from '@/shared/theme';
import { parseBrlCurrencyToCents } from '@/shared/utils/brlCurrency';

interface CampaignFormProps {
  initialValues: CampaignFormValues;
  submitLabel: string;
  onSubmit: (input: CampaignInput) => void;
}

export function CampaignForm({ initialValues, onSubmit, submitLabel }: CampaignFormProps) {
  const [values, setValues] = useState<CampaignFormValues>(initialValues);
  const [submitted, setSubmitted] = useState(false);
  const errors = useMemo(() => validateCampaignForm(values), [values]);

  function updateValue<Key extends keyof CampaignFormValues>(
    key: Key,
    value: CampaignFormValues[Key],
  ) {
    setValues((currentValues) => ({ ...currentValues, [key]: value }));
  }

  function handleSubmit() {
    setSubmitted(true);

    if (Object.keys(errors).length > 0) {
      return;
    }

    const startDate = parseBrazilianDate(values.startDate);
    const endDate = parseBrazilianDate(values.endDate);
    const targetAmountCents = parseBrlCurrencyToCents(values.targetAmount);

    if (!startDate || !endDate || targetAmountCents === null) {
      return;
    }

    onSubmit({
      endDate,
      name: values.name.trim(),
      startDate,
      targetAmountCents,
      targetQuantity: Number(values.targetQuantity),
    });
  }

  return (
    <View style={styles.form}>
      <View style={styles.fieldGroup}>
        <AppText variant="label">Marca / Produto</AppText>
        <AppTextInput
          accessibilityLabel="Marca ou produto"
          autoCapitalize="words"
          error={submitted ? errors.name : undefined}
          placeholder="Ex.: Protetor Solar La Roche"
          returnKeyType="next"
          value={values.name}
          onChangeText={(value) => updateValue('name', value)}
        />
      </View>

      <View style={styles.fieldGroup}>
        <AppText variant="label">Quantidade a vender</AppText>
        <AppTextInput
          accessibilityLabel="Quantidade a vender"
          error={submitted ? errors.targetQuantity : undefined}
          inputMode="numeric"
          keyboardType="number-pad"
          leftAdornment={<AppIcon color={colors.textMuted} name="target" size={22} />}
          placeholder="50"
          returnKeyType="next"
          value={values.targetQuantity}
          onChangeText={(value) => updateValue('targetQuantity', value.replace(/\D/g, ''))}
        />
      </View>

      <View style={styles.fieldGroup}>
        <AppText variant="label">Valor da meta (R$)</AppText>
        <BrlCurrencyInput
          accessibilityLabel="Valor financeiro da meta da campanha"
          error={submitted ? errors.targetAmount : undefined}
          placeholder="5.000,00"
          returnKeyType="next"
          value={values.targetAmount}
          onChangeText={(value) => updateValue('targetAmount', value)}
        />
      </View>

      <View style={styles.dateRow}>
        <View style={[styles.fieldGroup, styles.dateField]}>
          <AppText variant="label">Data inicial</AppText>
          <AppTextInput
            accessibilityLabel="Data inicial"
            error={submitted ? errors.startDate : undefined}
            inputMode="numeric"
            keyboardType="number-pad"
            placeholder="DD/MM/AAAA"
            value={values.startDate}
            onChangeText={(value) => updateValue('startDate', formatBrazilianDateInput(value))}
          />
        </View>

        <View style={[styles.fieldGroup, styles.dateField]}>
          <AppText variant="label">Data final</AppText>
          <AppTextInput
            accessibilityLabel="Data final"
            error={submitted ? errors.endDate : undefined}
            inputMode="numeric"
            keyboardType="number-pad"
            placeholder="DD/MM/AAAA"
            value={values.endDate}
            onChangeText={(value) => updateValue('endDate', formatBrazilianDateInput(value))}
          />
        </View>
      </View>

      <AppButton label={submitLabel} onPress={handleSubmit} />
    </View>
  );
}

const styles = StyleSheet.create({
  dateField: {
    flex: 1,
    minWidth: 132,
  },
  dateRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  fieldGroup: {
    gap: spacing.sm,
  },
  form: {
    gap: spacing.lg,
  },
});
