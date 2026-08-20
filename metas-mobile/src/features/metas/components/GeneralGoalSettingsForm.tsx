import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type {
  GoalGeneralSettings,
  GoalGeneralSettingsErrors,
  GoalConfigurationSaveInput,
} from '@/features/metas/types/goalSettings.types';
import { saveGoalConfigurationWithFeedback } from '@/features/metas/utils/saveGoalConfigurationFeedback';
import { validateGoalSettings } from '@/features/metas/utils/validateGoalSettings';
import { AppButton, AppText, AutomaticDaysFields, BrlCurrencyInput } from '@/shared/components';
import { useToast } from '@/shared/toast/ToastContext';
import { colors, radius, shadows, spacing } from '@/shared/theme';
import {
  centsToReais,
  formatCentsForBrlInput,
  parseBrlCurrencyToCents,
  reaisToCents,
} from '@/shared/utils/brlCurrency';
import {
  calculateMonthDayCounts,
  type PeriodDayCounts,
} from '@/shared/utils/datePeriods';

interface GeneralGoalSettingsFormProps {
  initialValues: GoalGeneralSettings;
  isSaving: boolean;
  periodMonth: string;
  onChange: (settings: GoalGeneralSettings) => void;
  onSave: (input: Omit<GoalConfigurationSaveInput, 'teamDistribution'>) => Promise<void>;
}

interface GoalGeneralSettingsFormValues {
  monthlyTarget: string;
  soldAmount: string;
}

function toFormValues(settings: GoalGeneralSettings): GoalGeneralSettingsFormValues {
  return {
    monthlyTarget: formatCentsForBrlInput(reaisToCents(settings.monthlyTarget) ?? 0),
    soldAmount: formatCentsForBrlInput(reaisToCents(settings.soldAmount) ?? 0),
  };
}

function toSettings(
  values: GoalGeneralSettingsFormValues,
  dayCounts: PeriodDayCounts,
): GoalGeneralSettings {
  const monthlyTargetCents = parseBrlCurrencyToCents(values.monthlyTarget);
  const soldAmountCents = parseBrlCurrencyToCents(values.soldAmount);

  return {
    monthlyTarget: monthlyTargetCents === null ? Number.NaN : centsToReais(monthlyTargetCents),
    remainingBusinessDays: dayCounts.remainingDays,
    soldAmount: soldAmountCents === null ? Number.NaN : centsToReais(soldAmountCents),
    totalBusinessDays: dayCounts.totalDays,
  };
}

export function GeneralGoalSettingsForm({
  initialValues,
  isSaving,
  periodMonth,
  onChange,
  onSave,
}: GeneralGoalSettingsFormProps) {
  const { hideToast, showToast } = useToast();
  const dayCounts = useMemo(
    () => calculateMonthDayCounts(periodMonth) ?? { remainingDays: 0, totalDays: 0 },
    [periodMonth],
  );
  const [values, setValues] = useState<GoalGeneralSettingsFormValues>(() =>
    toFormValues(initialValues),
  );
  const [errors, setErrors] = useState<GoalGeneralSettingsErrors>({});

  function updateValue<Key extends keyof GoalGeneralSettingsFormValues>(
    key: Key,
    value: GoalGeneralSettingsFormValues[Key],
  ) {
    const nextValues = { ...values, [key]: value };

    setValues(nextValues);
    setErrors((currentErrors) => ({ ...currentErrors, [key]: undefined }));
    hideToast();
    onChange(toSettings(nextValues, dayCounts));
  }

  async function handleSubmit() {
    const settings = toSettings(values, dayCounts);
    const validationErrors = validateGoalSettings(settings);
    const monthlyTargetCents = parseBrlCurrencyToCents(values.monthlyTarget);
    const soldAmountCents = parseBrlCurrencyToCents(values.soldAmount);

    setErrors(validationErrors);

    if (Object.keys(validationErrors).length > 0) {
      hideToast();
      return;
    }

    if (monthlyTargetCents === null || soldAmountCents === null) return;

    showToast(
      await saveGoalConfigurationWithFeedback(() =>
        onSave({
          monthlyTargetCents,
          remainingBusinessDays: settings.remainingBusinessDays,
          soldAmountCents,
          totalBusinessDays: settings.totalBusinessDays,
        }),
      ),
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.fieldGroup}>
        <AppText variant="label">Meta Mensal Total (R$)</AppText>
        <BrlCurrencyInput
          accessibilityLabel="Meta mensal total em reais"
          error={errors.monthlyTarget}
          placeholder="500.000,00"
          returnKeyType="next"
          value={values.monthlyTarget}
          onChangeText={(value) => updateValue('monthlyTarget', value)}
        />
      </View>

      <AutomaticDaysFields
        remainingDays={dayCounts.remainingDays}
        title="Dias Restantes / Total do Mês"
        totalDays={dayCounts.totalDays}
        totalLabel="Total do mês"
      />

      <View style={styles.fieldGroup}>
        <AppText variant="label">Total Vendido até o Momento (R$)</AppText>
        <BrlCurrencyInput
          accessibilityLabel="Total vendido até o momento em reais"
          error={errors.soldAmount}
          placeholder="120.000,00"
          returnKeyType="done"
          value={values.soldAmount}
          onChangeText={(value) => updateValue('soldAmount', value)}
          onSubmitEditing={() => void handleSubmit()}
        />
      </View>

      <AppButton
        label="Salvar configuração"
        loading={isSaving}
        onPress={() => void handleSubmit()}
      />
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
  fieldGroup: {
    gap: spacing.sm,
  },
});
