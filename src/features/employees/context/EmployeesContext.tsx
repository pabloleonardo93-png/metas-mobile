import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';

import { employeesMock } from '@/features/employees/mocks/employees.mock';
import type { Employee, EmployeeInput } from '@/features/employees/types/employee.types';

interface EmployeesContextValue {
  addEmployee: (input: EmployeeInput) => Employee;
  employees: Employee[];
  updateEmployee: (employeeId: string, input: EmployeeInput) => void;
}

const EmployeesContext = createContext<EmployeesContextValue | null>(null);

function cloneEmployees(): Employee[] {
  return employeesMock.map((employee) => ({
    ...employee,
    goal: employee.goal
      ? {
          ...employee.goal,
          campaignContributions: employee.goal.campaignContributions.map((contribution) => ({
            ...contribution,
          })),
        }
      : undefined,
  }));
}

export function EmployeesProvider({ children }: PropsWithChildren) {
  const [employees, setEmployees] = useState<Employee[]>(cloneEmployees);

  const addEmployee = useCallback((input: EmployeeInput): Employee => {
    const newEmployee: Employee = {
      ...input,
      id: `employee-${Date.now()}`,
      joinedAt: new Date().toISOString().slice(0, 10),
    };

    setEmployees((currentEmployees) => [...currentEmployees, newEmployee]);

    return newEmployee;
  }, []);

  const updateEmployee = useCallback((employeeId: string, input: EmployeeInput) => {
    setEmployees((currentEmployees) =>
      currentEmployees.map((employee) =>
        employee.id === employeeId ? { ...employee, ...input } : employee,
      ),
    );
  }, []);

  const value = useMemo(
    () => ({ addEmployee, employees, updateEmployee }),
    [addEmployee, employees, updateEmployee],
  );

  return <EmployeesContext.Provider value={value}>{children}</EmployeesContext.Provider>;
}

export function useEmployees(): EmployeesContextValue {
  const context = useContext(EmployeesContext);

  if (!context) {
    throw new Error('useEmployees deve ser usado dentro de EmployeesProvider.');
  }

  return context;
}
