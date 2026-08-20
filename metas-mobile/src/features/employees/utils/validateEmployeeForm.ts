import type {
  EmployeeFormErrors,
  EmployeeFormValues,
} from '@/features/employees/types/employee.types';
import { USER_ROLES } from '@/shared/config/userRoles';
import {
  formatLocalDateIso,
  isValidCivilDateIso,
  type LocalDateSource,
} from '@/shared/utils/localDate';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const normalizeEmployeeEmail = (value: string): string => value.trim().toLowerCase();

export function validateEmployeeEmail(value: string): string | undefined {
  const normalizedEmail = normalizeEmployeeEmail(value);
  if (!normalizedEmail) {
    return 'Informe o e-mail.';
  }
  if (!emailPattern.test(normalizedEmail)) {
    return 'Informe um e-mail válido.';
  }
  return undefined;
}

export function validateEmployeeForm(
  values: EmployeeFormValues,
  today: LocalDateSource = new Date(),
): EmployeeFormErrors {
  const errors: EmployeeFormErrors = {};
  const normalizedName = values.name.trim();

  if (!normalizedName) {
    errors.name = 'Informe o nome.';
  } else if (normalizedName.length < 3) {
    errors.name = 'Use pelo menos 3 caracteres.';
  }

  const emailError = validateEmployeeEmail(values.email);
  if (emailError) {
    errors.email = emailError;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(values.joinedAt)) {
    errors.joinedAt = 'Use o formato AAAA-MM-DD.';
  } else if (!isValidCivilDateIso(values.joinedAt) || values.joinedAt > formatLocalDateIso(today)) {
    errors.joinedAt = 'Informe uma data válida que não esteja no futuro.';
  }

  if (!values.role || !USER_ROLES.some((role) => role === values.role)) {
    errors.role = 'Selecione o cargo.';
  }

  if (values.status !== 'ATIVO' && values.status !== 'INATIVO') {
    errors.status = 'Selecione o status.';
  }

  return errors;
}
