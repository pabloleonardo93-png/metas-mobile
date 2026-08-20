import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from 'react';

import { useAuth } from '@/features/auth/context/AuthContext';
import { employeesApi } from '@/features/employees/api/employeesApi';
import { employeesReducer, initialEmployeesState } from '@/features/employees/state/employeesState';
import type {
  Employee,
  EmployeeAccessEmailInput,
  EmployeeInput,
  EmployeeStatus,
} from '@/features/employees/types/employee.types';
import { getEmployeeApiErrorMessage } from '@/features/employees/utils/employeeApiError';
import { useRealtime } from '@/realtime/RealtimeContext';

interface EmployeesContextValue {
  addEmployee(input: EmployeeInput): Promise<Employee>;
  changeEmployeeAccessEmail(employeeId: string, input: EmployeeAccessEmailInput): Promise<Employee>;
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
  const { subscribe } = useRealtime();
  const [state, dispatch] = useReducer(employeesReducer, initialEmployeesState);
  const loadPromiseRef = useRef<Promise<void> | null>(null);

  const loadEmployees = useCallback((showLoading: boolean): Promise<void> => {
    if (loadPromiseRef.current) {
      return loadPromiseRef.current;
    }

    if (showLoading) {
      dispatch({ type: 'loadStarted' });
    }
    const request = employeesApi
      .list()
      .then((employees) => dispatch({ type: 'loadSucceeded', employees }))
      .catch((error: unknown) => {
        dispatch({ type: 'loadFailed', errorMessage: getEmployeeApiErrorMessage(error) });
      })
      .finally(() => {
        loadPromiseRef.current = null;
      });
    loadPromiseRef.current = request;
    return request;
  }, []);

  const refreshEmployees = useCallback(() => loadEmployees(true), [loadEmployees]);

  useEffect(() => {
    if (authStatus === 'authenticated' && user?.role === 'GESTOR') {
      void refreshEmployees();
    }
  }, [authStatus, refreshEmployees, user?.role]);

  useEffect(() => {
    if (authStatus !== 'authenticated' || user?.role !== 'GESTOR') {
      return undefined;
    }
    return subscribe('employees.changed', () => loadEmployees(false));
  }, [authStatus, loadEmployees, subscribe, user?.role]);

  const addEmployee = useCallback(async (input: EmployeeInput): Promise<Employee> => {
    const employee = await employeesApi.create(input);
    dispatch({ type: 'upserted', employee });
    return employee;
  }, []);

  const changeEmployeeAccessEmail = useCallback(
    async (employeeId: string, input: EmployeeAccessEmailInput): Promise<Employee> => {
      const employee = await employeesApi.changeAccessEmail(employeeId, input);
      dispatch({ type: 'upserted', employee });
      return employee;
    },
    [],
  );

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
      changeEmployeeAccessEmail,
      employees: state.employees,
      errorMessage: state.errorMessage,
      isLoading: state.status === 'loading',
      refreshEmployees,
      setEmployeeStatus,
      updateEmployee,
    }),
    [
      addEmployee,
      changeEmployeeAccessEmail,
      refreshEmployees,
      setEmployeeStatus,
      state,
      updateEmployee,
    ],
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
