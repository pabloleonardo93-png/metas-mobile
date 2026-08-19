import type { AuthenticatedSession, UserRole } from '../auth/auth.types.js';

export type EmployeeStatus = 'ATIVO' | 'INATIVO';

export interface EmployeeDto {
  email: string;
  id: string;
  joinedOn: string;
  name: string;
  role: UserRole;
  status: EmployeeStatus;
}

export interface EmployeeMutationInput {
  email: string;
  joinedOn: string;
  name: string;
  role: UserRole;
  status: EmployeeStatus;
}

export interface EmployeeService {
  create(session: AuthenticatedSession, input: EmployeeMutationInput): Promise<EmployeeDto>;
  getById(session: AuthenticatedSession, employeeId: string): Promise<EmployeeDto>;
  list(session: AuthenticatedSession): Promise<EmployeeDto[]>;
  setStatus(
    session: AuthenticatedSession,
    employeeId: string,
    status: EmployeeStatus,
  ): Promise<EmployeeDto>;
  update(
    session: AuthenticatedSession,
    employeeId: string,
    input: EmployeeMutationInput,
  ): Promise<EmployeeDto>;
}
