import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
} from 'react';

import { useAuth } from '@/features/auth/context/AuthContext';
import { employeesApi } from '@/features/employees/api/employeesApi';
import { employeesReducer, initialEmployeesState } from '@/features/employees/state/employeesState';
import type {
  Employee,
  EmployeeInput,
  EmployeeStatus,
} from '@/features/employees/types/employee.types';
import { getEmployeeApiErrorMessage } from '@/features/employees/utils/employeeApiError';

interface EmployeesContextValue {
  addEmployee(input: EmployeeInput): Promise<Employee>;
  employees: Employee[];
  errorMessage: string | null;
  isLoading: boolean;
  refreshEmployees(): Promise<void>;
  setEmployeeStatus(employeeId: string, status: EmployeeStatus): Promise<Employee>;
  updateEmployee(employeeId: string, input: EmployeeInput): Promise<Employee>;
}

const EmployeesContext = createContext<EmployeesContextValue | null>(null);

export function EmployeesProvider({ children }: PropsWithChildren) {
  const { status: authStatus, user } = useAuth();
  const [state, dispatch] = useReducer(employeesReducer, initialEmployeesState);

  const refreshEmployees = useCallback(async () => {
    dispatch({ type: 'loadStarted' });
    try {
      dispatch({ type: 'loadSucceeded', employees: await employeesApi.list() });
    } catch (error: unknown) {
      dispatch({ type: 'loadFailed', errorMessage: getEmployeeApiErrorMessage(error) });
    }
  }, []);

  useEffect(() => {
    if (authStatus === 'authenticated' && user?.role === 'GESTOR') {
      void refreshEmployees();
    }
  }, [authStatus, refreshEmployees, user?.role]);

  const addEmployee = useCallback(async (input: EmployeeInput): Promise<Employee> => {
    const employee = await employeesApi.create(input);
    dispatch({ type: 'upserted', employee });
    return employee;
  }, []);

  const updateEmployee = useCallback(
    async (employeeId: string, input: EmployeeInput): Promise<Employee> => {
      const employee = await employeesApi.update(employeeId, input);
      dispatch({ type: 'upserted', employee });
      return employee;
    },
    [],
  );

  const setEmployeeStatus = useCallback(
    async (employeeId: string, status: EmployeeStatus): Promise<Employee> => {
      const employee = await employeesApi.setStatus(employeeId, status);
      dispatch({ type: 'upserted', employee });
      return employee;
    },
    [],
  );

  const value = useMemo(
    () => ({
      addEmployee,
      employees: state.employees,
      errorMessage: state.errorMessage,
      isLoading: state.status === 'loading',
      refreshEmployees,
      setEmployeeStatus,
      updateEmployee,
    }),
    [addEmployee, refreshEmployees, setEmployeeStatus, state, updateEmployee],
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
