import type {
  GoalGeneralSettings,
  GoalGeneralSettingsErrors,
} from '@/features/metas/types/goalSettings.types';

export function validateGoalSettings(settings: GoalGeneralSettings): GoalGeneralSettingsErrors {
  const errors: GoalGeneralSettingsErrors = {};

  if (!Number.isFinite(settings.monthlyTarget) || settings.monthlyTarget <= 0) {
    errors.monthlyTarget = 'Informe uma meta mensal maior que zero.';
  }

  if (!Number.isInteger(settings.remainingBusinessDays) || settings.remainingBusinessDays < 0) {
    errors.remainingBusinessDays = 'Informe os dias restantes sem valores negativos.';
  }

  if (!Number.isInteger(settings.totalBusinessDays) || settings.totalBusinessDays <= 0) {
    errors.totalBusinessDays = 'Informe o total de dias do mês.';
  }

  if (
    !errors.remainingBusinessDays &&
    !errors.totalBusinessDays &&
    settings.remainingBusinessDays > settings.totalBusinessDays
  ) {
    errors.remainingBusinessDays = 'Os dias restantes não podem superar o total.';
  }

  if (!Number.isFinite(settings.soldAmount) || settings.soldAmount < 0) {
    errors.soldAmount = 'Informe o total vendido até o momento.';
  }

  return errors;
}
