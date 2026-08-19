import type { Employee } from '../types/employee.types';

export type EmployeesLoadStatus = 'error' | 'loading' | 'ready';

export interface EmployeesState {
  employees: Employee[];
  errorMessage: string | null;
  status: EmployeesLoadStatus;
}

export type EmployeesAction =
  | { type: 'loadFailed'; errorMessage: string }
  | { type: 'loadStarted' }
  | { type: 'loadSucceeded'; employees: Employee[] }
  | { type: 'upserted'; employee: Employee };

export const initialEmployeesState: EmployeesState = {
  employees: [],
  errorMessage: null,
  status: 'loading',
};

export function employeesReducer(state: EmployeesState, action: EmployeesAction): EmployeesState {
  switch (action.type) {
    case 'loadStarted':
      return { ...state, errorMessage: null, status: 'loading' };
    case 'loadSucceeded':
      return { employees: action.employees, errorMessage: null, status: 'ready' };
    case 'loadFailed':
      return { ...state, errorMessage: action.errorMessage, status: 'error' };
    case 'upserted': {
      const exists = state.employees.some((employee) => employee.id === action.employee.id);
      return {
        employees: exists
          ? state.employees.map((employee) =>
              employee.id === action.employee.id ? action.employee : employee,
            )
          : [...state.employees, action.employee],
        errorMessage: null,
        status: 'ready',
      };
    }
  }
}
