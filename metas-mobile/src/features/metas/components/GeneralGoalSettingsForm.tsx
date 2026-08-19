import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { BusinessDaysFields } from '@/features/metas/components/BusinessDaysFields';
import type {
  GoalGeneralSettings,
  GoalGeneralSettingsErrors,
  GoalConfigurationSaveInput,
} from '@/features/metas/types/goalSettings.types';
import { getGoalApiErrorMessage } from '@/features/metas/utils/goalApiError';
import { validateGoalSettings } from '@/features/metas/utils/validateGoalSettings';
import { AppButton, AppText, BrlCurrencyInput } from '@/shared/components';
import { colors, radius, shadows, spacing } from '@/shared/theme';
import {
  centsToReais,
  formatCentsForBrlInput,
  parseBrlCurrencyToCents,
  reaisToCents,
} from '@/shared/utils/brlCurrency';

interface GeneralGoalSettingsFormProps {
  initialValues: GoalGeneralSettings;
  isSaving: boolean;
  onChange: (settings: GoalGeneralSettings) => void;
  onSave: (input: Omit<GoalConfigurationSaveInput, 'teamDistribution'>) => Promise<void>;
}

interface GoalGeneralSettingsFormValues {
  monthlyTarget: string;
  remainingBusinessDays: string;
  soldAmount: string;
  totalBusinessDays: string;
}

function toFormValues(settings: GoalGeneralSettings): GoalGeneralSettingsFormValues {
  return {
    monthlyTarget: formatCentsForBrlInput(reaisToCents(settings.monthlyTarget) ?? 0),
    remainingBusinessDays: `${settings.remainingBusinessDays}`,
    soldAmount: formatCentsForBrlInput(reaisToCents(settings.soldAmount) ?? 0),
    totalBusinessDays: `${settings.totalBusinessDays}`,
  };
}

function toSettings(values: GoalGeneralSettingsFormValues): GoalGeneralSettings {
  const monthlyTargetCents = parseBrlCurrencyToCents(values.monthlyTarget);
  const soldAmountCents = parseBrlCurrencyToCents(values.soldAmount);

  return {
    monthlyTarget: monthlyTargetCents === null ? Number.NaN : centsToReais(monthlyTargetCents),
    remainingBusinessDays: Number(values.remainingBusinessDays),
    soldAmount: soldAmountCents === null ? Number.NaN : centsToReais(soldAmountCents),
    totalBusinessDays: Number(values.totalBusinessDays),
  };
}

export function GeneralGoalSettingsForm({
  initialValues,
  isSaving,
  onChange,
  onSave,
}: GeneralGoalSettingsFormProps) {
  const [values, setValues] = useState<GoalGeneralSettingsFormValues>(() =>
    toFormValues(initialValues),
  );
  const [errors, setErrors] = useState<GoalGeneralSettingsErrors>({});
  const [feedback, setFeedback] = useState<{ message: string; type: 'error' | 'success' } | null>(
    null,
  );

  function updateValue<Key extends keyof GoalGeneralSettingsFormValues>(
    key: Key,
    value: GoalGeneralSettingsFormValues[Key],
  ) {
    const nextValues = { ...values, [key]: value };

    setValues(nextValues);
    setErrors((currentErrors) => ({ ...currentErrors, [key]: undefined }));
    setFeedback(null);
    onChange(toSettings(nextValues));
  }

  async function handleSubmit() {
    const settings = toSettings(values);
    const validationErrors = validateGoalSettings(settings);
    const monthlyTargetCents = parseBrlCurrencyToCents(values.monthlyTarget);
    const soldAmountCents = parseBrlCurrencyToCents(values.soldAmount);

    setErrors(validationErrors);

    if (Object.keys(validationErrors).length > 0) {
      setFeedback(null);
      return;
    }

    if (monthlyTargetCents === null || soldAmountCents === null) return;

    try {
      await onSave({
        monthlyTargetCents,
        remainingBusinessDays: settings.remainingBusinessDays,
        soldAmountCents,
        totalBusinessDays: settings.totalBusinessDays,
      });
      setFeedback({ message: 'Configuração salva com sucesso.', type: 'success' });
    } catch (error: unknown) {
      setFeedback({ message: getGoalApiErrorMessage(error), type: 'error' });
    }
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

      {feedback ? (
        <View
          accessibilityLiveRegion="polite"
          style={[
            styles.confirmation,
            feedback.type === 'error' ? styles.errorFeedback : styles.successFeedback,
          ]}
        >
          <View
            style={[
              styles.confirmationDot,
              feedback.type === 'error' ? styles.errorDot : styles.successDot,
            ]}
          />
          <AppText
            color={feedback.type === 'error' ? 'error' : 'success'}
            style={styles.confirmationText}
            variant="caption"
          >
            {feedback.message}
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
    borderRadius: radius.pill,
    height: 8,
    width: 8,
  },
  confirmationText: {
    flex: 1,
  },
  errorDot: {
    backgroundColor: colors.error,
  },
  errorFeedback: {
    backgroundColor: colors.primarySubtle,
  },
  fieldGroup: {
    gap: spacing.sm,
  },
  successDot: {
    backgroundColor: colors.success,
  },
  successFeedback: {
    backgroundColor: colors.successSubtle,
  },
});
