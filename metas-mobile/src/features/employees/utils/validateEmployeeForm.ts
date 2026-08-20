import type {
  EmployeeFormErrors,
  EmployeeFormValues,
} from '@/features/employees/types/employee.types';
import { USER_ROLES } from '@/shared/config/userRoles';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

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

export function validateEmployeeForm(values: EmployeeFormValues): EmployeeFormErrors {
  const errors: EmployeeFormErrors = {};
  const normalizedName = values.name.trim();

  if (!normalizedName) {
    errors.name = 'Informe o nome.';
  } else if (normalizedName.length < 3) {
    errors.name = 'Use pelo menos 3 caracteres.';
  }

  errors.email = validateEmployeeEmail(values.email);

  if (!datePattern.test(values.joinedAt)) {
    errors.joinedAt = 'Use o formato AAAA-MM-DD.';
  } else {
    const joinedAt = new Date(`${values.joinedAt}T00:00:00`);
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    if (Number.isNaN(joinedAt.getTime()) || joinedAt > today) {
      errors.joinedAt = 'Informe uma data válida que não esteja no futuro.';
    }
  }

  if (!values.role || !USER_ROLES.some((role) => role === values.role)) {
    errors.role = 'Selecione o cargo.';
  }

  if (values.status !== 'ATIVO' && values.status !== 'INATIVO') {
    errors.status = 'Selecione o status.';
  }

  return errors;
}
