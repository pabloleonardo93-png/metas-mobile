import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type {
  Employee,
  EmployeeFormValues,
  EmployeeStatus,
} from '@/features/employees/types/employee.types';
import {
  createEmployeeMutationRunner,
  type EmployeeMutationFeedback,
} from '@/features/employees/utils/employeeMutationFeedback';
import {
  normalizeEmployeeEmail,
  validateEmployeeEmail,
  validateEmployeeForm,
} from '@/features/employees/utils/validateEmployeeForm';
import { USER_ROLE_LABELS, USER_ROLES } from '@/shared/config/userRoles';
import { AppButton, AppText, AppTextInput } from '@/shared/components';
import { colors, radius, spacing } from '@/shared/theme';
import type { UserRole } from '@/shared/types/userRole';

interface EmployeeFormProps {
  googleLinked?: boolean;
  initialValues: EmployeeFormValues;
  onChangeAccessEmail?: (email: string) => Promise<Employee | null>;
  submitSuccessMessage: string;
  submitLabel: string;
  onSubmit: (values: EmployeeFormValues & { role: UserRole }) => Promise<void> | void;
}

const STATUS_OPTIONS: readonly { label: string; value: EmployeeStatus }[] = [
  { label: 'Ativo', value: 'ATIVO' },
  { label: 'Inativo', value: 'INATIVO' },
];

function FeedbackMessage({ feedback }: { feedback: EmployeeMutationFeedback }) {
  return (
    <View
      accessibilityLiveRegion="polite"
      style={[
        styles.feedback,
        feedback.type === 'error' ? styles.errorFeedback : styles.successFeedback,
      ]}
    >
      <View
        style={[
          styles.feedbackDot,
          feedback.type === 'error' ? styles.errorDot : styles.successDot,
        ]}
      />
      <AppText
        color={feedback.type === 'error' ? 'error' : 'success'}
        style={styles.feedbackText}
        variant="caption"
      >
        {feedback.message}
      </AppText>
    </View>
  );
}

export function EmployeeForm({
  googleLinked = false,
  initialValues,
  onChangeAccessEmail,
  onSubmit,
  submitLabel,
  submitSuccessMessage,
}: EmployeeFormProps) {
  const [values, setValues] = useState<EmployeeFormValues>(initialValues);
  const [submitted, setSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleLinked, setIsGoogleLinked] = useState(googleLinked);
  const [isChangingAccessEmail, setIsChangingAccessEmail] = useState(false);
  const [showAccessEmailChange, setShowAccessEmailChange] = useState(false);
  const [newAccessEmail, setNewAccessEmail] = useState('');
  const [accessEmailSubmitted, setAccessEmailSubmitted] = useState(false);
  const [submitFeedback, setSubmitFeedback] = useState<EmployeeMutationFeedback | null>(null);
  const [accessEmailFeedback, setAccessEmailFeedback] = useState<EmployeeMutationFeedback | null>(
    null,
  );
  const submitRunner = useMemo(() => createEmployeeMutationRunner(), []);
  const accessEmailRunner = useMemo(() => createEmployeeMutationRunner(), []);
  const errors = useMemo(() => validateEmployeeForm(values), [values]);
  const accessEmailError = validateEmployeeEmail(newAccessEmail);

  function updateValue<Key extends keyof EmployeeFormValues>(
    key: Key,
    value: EmployeeFormValues[Key],
  ) {
    setValues((currentValues) => ({ ...currentValues, [key]: value }));
    setSubmitFeedback(null);
  }

  async function handleSubmit() {
    setSubmitted(true);

    if (Object.keys(errors).length > 0 || !values.role) {
      return;
    }
    const role = values.role;

    const outcome = await submitRunner.run(
      () =>
        Promise.resolve(
          onSubmit({
            ...values,
            email: normalizeEmployeeEmail(values.email),
            name: values.name.trim(),
            role,
          }),
        ),
      {
        error: 'Não foi possível salvar as alterações. Tente novamente.',
        success: submitSuccessMessage,
      },
      {
        onFinished: () => setIsSubmitting(false),
        onStarted: () => {
          setIsSubmitting(true);
          setSubmitFeedback(null);
        },
      },
    );
    if (outcome) setSubmitFeedback(outcome.feedback);
  }

  async function handleAccessEmailChange() {
    setAccessEmailSubmitted(true);
    if (accessEmailError || !onChangeAccessEmail) {
      return;
    }

    const outcome = await accessEmailRunner.run(
      () => onChangeAccessEmail(normalizeEmployeeEmail(newAccessEmail)),
      {
        error: 'Não foi possível alterar o e-mail de acesso. Tente novamente.',
        success: 'E-mail de acesso alterado com sucesso.',
      },
      {
        onFinished: () => setIsChangingAccessEmail(false),
        onStarted: () => {
          setAccessEmailFeedback(null);
          setIsChangingAccessEmail(true);
        },
      },
    );
    if (!outcome) return;
    if (!outcome.ok) {
      setAccessEmailFeedback(outcome.feedback);
      return;
    }

    const employee = outcome.value;
    if (employee) {
      setValues((currentValues) => ({ ...currentValues, email: employee.email }));
      setIsGoogleLinked(employee.googleLinked);
      setNewAccessEmail('');
      setAccessEmailSubmitted(false);
      setShowAccessEmailChange(false);
      setAccessEmailFeedback(outcome.feedback);
    }
  }

  return (
    <View style={styles.form}>
      <View style={styles.fieldGroup}>
        <AppText variant="label">Nome</AppText>
        <AppTextInput
          accessibilityLabel="Nome do funcionário"
          autoCapitalize="words"
          autoComplete="name"
          error={submitted ? errors.name : undefined}
          placeholder="Nome completo"
          returnKeyType="next"
          textContentType="name"
          value={values.name}
          onChangeText={(value) => updateValue('name', value)}
        />
      </View>

      <View style={styles.fieldGroup}>
        <AppText variant="label">E-mail de acesso</AppText>
        <AppTextInput
          accessibilityLabel="E-mail do funcionário"
          autoCapitalize="none"
          autoComplete="email"
          autoCorrect={false}
          editable={!isGoogleLinked}
          error={submitted ? errors.email : undefined}
          inputMode="email"
          keyboardType="email-address"
          placeholder="nome@farmacia.com"
          returnKeyType="next"
          textContentType="emailAddress"
          value={values.email}
          onChangeText={(value) => updateValue('email', value)}
        />
        {isGoogleLinked ? (
          <>
            <AppText color="textMuted" variant="caption">
              Esta conta Google já está vinculada. Use a ação abaixo para trocar o acesso.
            </AppText>
            <AppButton
              label="Alterar e-mail de acesso"
              variant="secondary"
              onPress={() => {
                setAccessEmailFeedback(null);
                setShowAccessEmailChange(true);
              }}
            />
          </>
        ) : null}
        {showAccessEmailChange ? (
          <View style={styles.accessEmailChange}>
            <AppText variant="label">Novo e-mail de acesso</AppText>
            <AppTextInput
              accessibilityLabel="Novo e-mail de acesso"
              autoCapitalize="none"
              autoComplete="email"
              autoCorrect={false}
              error={accessEmailSubmitted ? accessEmailError : undefined}
              inputMode="email"
              keyboardType="email-address"
              placeholder="novo@gmail.com"
              textContentType="emailAddress"
              value={newAccessEmail}
              onChangeText={(value) => {
                setAccessEmailFeedback(null);
                setNewAccessEmail(value);
              }}
            />
            <View style={styles.accessEmailActions}>
              <AppButton
                label="Cancelar"
                variant="secondary"
                onPress={() => {
                  setAccessEmailSubmitted(false);
                  setAccessEmailFeedback(null);
                  setNewAccessEmail('');
                  setShowAccessEmailChange(false);
                }}
              />
              <AppButton
                label="Confirmar troca"
                loading={isChangingAccessEmail}
                onPress={() => void handleAccessEmailChange()}
              />
            </View>
          </View>
        ) : null}
        {accessEmailFeedback ? <FeedbackMessage feedback={accessEmailFeedback} /> : null}
      </View>

      <View style={styles.fieldGroup}>
        <AppText variant="label">Data de entrada</AppText>
        <AppTextInput
          accessibilityLabel="Data de entrada do funcionário"
          autoCapitalize="none"
          autoCorrect={false}
          error={submitted ? errors.joinedAt : undefined}
          inputMode="numeric"
          placeholder="AAAA-MM-DD"
          value={values.joinedAt}
          onChangeText={(value) => updateValue('joinedAt', value)}
        />
      </View>

      <View style={styles.fieldGroup}>
        <AppText variant="label">Cargo</AppText>
        <View accessibilityRole="radiogroup" style={styles.optionsWrap}>
          {USER_ROLES.map((role) => {
            const isSelected = role === values.role;

            return (
              <Pressable
                key={role}
                accessibilityLabel={USER_ROLE_LABELS[role].singular}
                accessibilityRole="radio"
                accessibilityState={{ checked: isSelected }}
                style={({ pressed }) => [
                  styles.option,
                  isSelected && styles.optionSelected,
                  pressed && styles.optionPressed,
                ]}
                onPress={() => updateValue('role', role)}
              >
                <AppText color={isSelected ? 'onPrimary' : 'textMuted'} variant="label">
                  {USER_ROLE_LABELS[role].singular}
                </AppText>
              </Pressable>
            );
          })}
        </View>
        {submitted && errors.role ? (
          <AppText color="error" style={styles.error} variant="caption">
            {errors.role}
          </AppText>
        ) : null}
      </View>

      <View style={styles.fieldGroup}>
        <AppText variant="label">Status</AppText>
        <View accessibilityRole="radiogroup" style={styles.statusSelector}>
          {STATUS_OPTIONS.map((status) => {
            const isSelected = status.value === values.status;

            return (
              <Pressable
                key={status.value}
                accessibilityLabel={status.label}
                accessibilityRole="radio"
                accessibilityState={{ checked: isSelected }}
                style={({ pressed }) => [
                  styles.statusOption,
                  isSelected && styles.optionSelected,
                  pressed && styles.optionPressed,
                ]}
                onPress={() => updateValue('status', status.value)}
              >
                <AppText color={isSelected ? 'onPrimary' : 'textMuted'} variant="label">
                  {status.label}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      </View>

      <AppButton label={submitLabel} loading={isSubmitting} onPress={() => void handleSubmit()} />
      {submitFeedback ? <FeedbackMessage feedback={submitFeedback} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  accessEmailActions: {
    gap: spacing.sm,
  },
  accessEmailChange: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  error: {
    marginLeft: spacing.xs,
  },
  errorDot: {
    backgroundColor: colors.error,
  },
  errorFeedback: {
    backgroundColor: colors.primarySubtle,
  },
  feedback: {
    alignItems: 'center',
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  feedbackDot: {
    borderRadius: radius.pill,
    height: 8,
    width: 8,
  },
  feedbackText: {
    flex: 1,
  },
  fieldGroup: {
    gap: spacing.sm,
  },
  form: {
    gap: spacing.lg,
  },
  option: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.pill,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 124,
    paddingHorizontal: spacing.md,
  },
  optionPressed: {
    opacity: 0.7,
  },
  optionSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  optionsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  statusOption: {
    alignItems: 'center',
    borderRadius: radius.sm,
    flex: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  statusSelector: {
    backgroundColor: colors.primarySubtle,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    padding: spacing.xs,
  },
  successDot: {
    backgroundColor: colors.success,
  },
  successFeedback: {
    backgroundColor: colors.successSubtle,
  },
});
