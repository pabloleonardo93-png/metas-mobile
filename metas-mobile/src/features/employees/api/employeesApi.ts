import { sessionTokenStorage } from '@/features/auth/storage/sessionTokenStorage';
import { EmployeeApiClient } from '@/features/employees/services/employeeApiClient';
import { apiRequest } from '@/shared/api/apiClient';

export const employeesApi = new EmployeeApiClient(apiRequest, sessionTokenStorage);
