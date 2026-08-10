import type {
  EmployeeFormErrors,
  EmployeeFormValues,
} from '@/features/employees/types/employee.types';
import { USER_ROLES } from '@/shared/config/userRoles';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmployeeForm(values: EmployeeFormValues): EmployeeFormErrors {
  const errors: EmployeeFormErrors = {};
  const normalizedName = values.name.trim();
  const normalizedEmail = values.email.trim();

  if (!normalizedName) {
    errors.name = 'Informe o nome.';
  } else if (normalizedName.length < 3) {
    errors.name = 'Use pelo menos 3 caracteres.';
  }

  if (!normalizedEmail) {
    errors.email = 'Informe o e-mail.';
  } else if (!emailPattern.test(normalizedEmail)) {
    errors.email = 'Informe um e-mail válido.';
  }

  if (!values.role || !USER_ROLES.some((role) => role === values.role)) {
    errors.role = 'Selecione o cargo.';
  }

  if (values.status !== 'ATIVO' && values.status !== 'INATIVO') {
    errors.status = 'Selecione o status.';
  }

  return errors;
}
