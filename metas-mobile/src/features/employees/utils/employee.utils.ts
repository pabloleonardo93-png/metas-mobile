import type {
  Employee,
  EmployeeRoleFilter,
  TeamRoleSummary,
} from '@/features/employees/types/employee.types';
import { USER_ROLE_LABELS } from '@/shared/config/userRoles';

export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase('pt-BR');
}

export function filterEmployees(
  employees: readonly Employee[],
  search: string,
  roleFilter: EmployeeRoleFilter,
): Employee[] {
  const normalizedSearch = normalizeSearchText(search);

  return employees.filter((employee) => {
    if (roleFilter !== 'ALL' && employee.role !== roleFilter) {
      return false;
    }

    if (!normalizedSearch) {
      return true;
    }

    const searchableText = normalizeSearchText(
      `${employee.name} ${employee.role} ${USER_ROLE_LABELS[employee.role].singular} ${USER_ROLE_LABELS[employee.role].plural}`,
    );

    return searchableText.includes(normalizedSearch);
  });
}

export function countActiveEmployees(employees: readonly Employee[]): number {
  return employees.filter((employee) => employee.status === 'ATIVO').length;
}

export function summarizeTeamByRole(employees: readonly Employee[]): TeamRoleSummary {
  return employees.reduce<TeamRoleSummary>(
    (summary, employee) => ({
      ...summary,
      [employee.role]: summary[employee.role] + 1,
    }),
    {
      GESTOR: 0,
      BALCONISTA: 0,
      FARMACEUTICO: 0,
      CAIXA: 0,
    },
  );
}

export function formatJoinedDate(value: string): string {
  const date = new Date(`${value}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return 'Data não informada';
  }

  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(date);
}
