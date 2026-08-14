import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { BusinessDaysFields } from '@/features/metas/components/BusinessDaysFields';
import type {
  GoalGeneralSettings,
  GoalGeneralSettingsErrors,
} from '@/features/metas/types/goalSettings.types';
import {
  formatCurrencyInput,
  formatCurrencyTextInput,
  parseCurrencyInput,
} from '@/features/metas/utils/formatCurrency';
import { validateGoalSettings } from '@/features/metas/utils/validateGoalSettings';
import { AppButton, AppText, AppTextInput } from '@/shared/components';
import { colors, radius, shadows, spacing } from '@/shared/theme';

interface GeneralGoalSettingsFormProps {
  initialValues: GoalGeneralSettings;
  onChange: (settings: GoalGeneralSettings) => void;
}

interface GoalGeneralSettingsFormValues {
  monthlyTarget: string;
  remainingBusinessDays: string;
  soldAmount: string;
  totalBusinessDays: string;
}

function toFormValues(settings: GoalGeneralSettings): GoalGeneralSettingsFormValues {
  return {
    monthlyTarget: formatCurrencyInput(settings.monthlyTarget),
    remainingBusinessDays: `${settings.remainingBusinessDays}`,
    soldAmount: formatCurrencyInput(settings.soldAmount),
    totalBusinessDays: `${settings.totalBusinessDays}`,
  };
}

function toSettings(values: GoalGeneralSettingsFormValues): GoalGeneralSettings {
  return {
    monthlyTarget: parseCurrencyInput(values.monthlyTarget),
    remainingBusinessDays: Number(values.remainingBusinessDays),
    soldAmount: parseCurrencyInput(values.soldAmount),
    totalBusinessDays: Number(values.totalBusinessDays),
  };
}

export function GeneralGoalSettingsForm({ initialValues, onChange }: GeneralGoalSettingsFormProps) {
  const [values, setValues] = useState<GoalGeneralSettingsFormValues>(() =>
    toFormValues(initialValues),
  );
  const [errors, setErrors] = useState<GoalGeneralSettingsErrors>({});
  const [savedSettings, setSavedSettings] = useState<GoalGeneralSettings | null>(null);

  function updateValue<Key extends keyof GoalGeneralSettingsFormValues>(
    key: Key,
    value: GoalGeneralSettingsFormValues[Key],
  ) {
    const nextValues = { ...values, [key]: value };

    setValues(nextValues);
    setErrors((currentErrors) => ({ ...currentErrors, [key]: undefined }));
    setSavedSettings(null);
    onChange(toSettings(nextValues));
  }

  function handleSubmit() {
    const settings = toSettings(values);
    const validationErrors = validateGoalSettings(settings);

    setErrors(validationErrors);

    if (Object.keys(validationErrors).length > 0) {
      setSavedSettings(null);
      return;
    }

    setSavedSettings(settings);
  }

  return (
    <View style={styles.card}>
      <View style={styles.fieldGroup}>
        <AppText variant="label">Meta Mensal Total (R$)</AppText>
        <AppTextInput
          accessibilityLabel="Meta mensal total em reais"
          error={errors.monthlyTarget}
          inputMode="numeric"
          keyboardType="number-pad"
          placeholder="500.000"
          returnKeyType="next"
          value={values.monthlyTarget}
          onChangeText={(value) => updateValue('monthlyTarget', formatCurrencyTextInput(value))}
        />
      </View>

      <BusinessDaysFields
        remainingError={errors.remainingBusinessDays}
        remainingValue={values.remainingBusinessDays}
        totalError={errors.totalBusinessDays}
        totalValue={values.totalBusinessDays}
        onRemainingChange={(value) => updateValue('remainingBusinessDays', value)}
        onTotalChange={(value) => updateValue('totalBusinessDays', value)}
      />

      <View style={styles.fieldGroup}>
        <AppText variant="label">Total Vendido até o Momento (R$)</AppText>
        <AppTextInput
          accessibilityLabel="Total vendido até o momento em reais"
          error={errors.soldAmount}
          inputMode="numeric"
          keyboardType="number-pad"
          placeholder="120.000"
          returnKeyType="done"
          value={values.soldAmount}
          onChangeText={(value) => updateValue('soldAmount', formatCurrencyTextInput(value))}
          onSubmitEditing={handleSubmit}
        />
      </View>

      <AppButton label="Salvar configuração" onPress={handleSubmit} />

      {savedSettings ? (
        <View accessibilityLiveRegion="polite" style={styles.confirmation}>
          <View style={styles.confirmationDot} />
          <AppText color="primary" style={styles.confirmationText} variant="caption">
            Configuração salva localmente para demonstração.
          </AppText>
        </View>
      ) : null}
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
  confirmation: {
    alignItems: 'center',
    backgroundColor: colors.primarySubtle,
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  confirmationDot: {
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    height: 8,
    width: 8,
  },
  confirmationText: {
    flex: 1,
  },
  fieldGroup: {
    gap: spacing.sm,
  },
});
