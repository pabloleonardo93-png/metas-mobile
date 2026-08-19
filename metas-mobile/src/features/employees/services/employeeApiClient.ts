import type { Employee, EmployeeInput, EmployeeStatus } from '../types/employee.types';

interface EmployeeApiResponse {
  email: string;
  id: string;
  joinedOn: string;
  name: string;
  role: Employee['role'];
  status: EmployeeStatus;
}

interface EmployeeApiRequestOptions {
  body?: unknown;
  method?: 'GET' | 'PATCH' | 'POST';
  sessionToken?: string;
}

export interface EmployeeApiRequest {
  <Result>(path: string, options?: EmployeeApiRequestOptions): Promise<Result>;
}

export interface EmployeeSessionStorage {
  getToken(): Promise<string | null>;
}

export interface EmployeeApiGateway {
  create(input: EmployeeInput): Promise<Employee>;
  getById(employeeId: string): Promise<Employee>;
  list(): Promise<Employee[]>;
  setStatus(employeeId: string, status: EmployeeStatus): Promise<Employee>;
  update(employeeId: string, input: EmployeeInput): Promise<Employee>;
}

export class EmployeeSessionUnavailableError extends Error {
  constructor() {
    super('Authenticated session is unavailable');
    this.name = 'EmployeeSessionUnavailableError';
  }
}

const toEmployee = (response: EmployeeApiResponse): Employee => ({
  email: response.email,
  id: response.id,
  joinedAt: response.joinedOn,
  name: response.name,
  role: response.role,
  status: response.status,
});

const toRequest = (input: EmployeeInput) => ({
  email: input.email,
  joinedOn: input.joinedAt,
  name: input.name,
  role: input.role,
  status: input.status,
});

export class EmployeeApiClient implements EmployeeApiGateway {
  constructor(
    private readonly request: EmployeeApiRequest,
    private readonly storage: EmployeeSessionStorage,
  ) {}

  async list(): Promise<Employee[]> {
    const sessionToken = await this.requireToken();
    const employees = await this.request<EmployeeApiResponse[]>('/v1/manager/employees', {
      sessionToken,
    });
    return employees.map(toEmployee);
  }

  async getById(employeeId: string): Promise<Employee> {
    const sessionToken = await this.requireToken();
    return toEmployee(
      await this.request<EmployeeApiResponse>(`/v1/manager/employees/${employeeId}`, {
        sessionToken,
      }),
    );
  }

  async create(input: EmployeeInput): Promise<Employee> {
    const sessionToken = await this.requireToken();
    return toEmployee(
      await this.request<EmployeeApiResponse>('/v1/manager/employees', {
        body: toRequest(input),
        method: 'POST',
        sessionToken,
      }),
    );
  }

  async update(employeeId: string, input: EmployeeInput): Promise<Employee> {
    const sessionToken = await this.requireToken();
    return toEmployee(
      await this.request<EmployeeApiResponse>(`/v1/manager/employees/${employeeId}`, {
        body: toRequest(input),
        method: 'PATCH',
        sessionToken,
      }),
    );
  }

  async setStatus(employeeId: string, status: EmployeeStatus): Promise<Employee> {
    const sessionToken = await this.requireToken();
    return toEmployee(
      await this.request<EmployeeApiResponse>(`/v1/manager/employees/${employeeId}/status`, {
        body: { status },
        method: 'PATCH',
        sessionToken,
      }),
    );
  }

  private async requireToken(): Promise<string> {
    const sessionToken = await this.storage.getToken();
    if (!sessionToken) {
      throw new EmployeeSessionUnavailableError();
    }
    return sessionToken;
  }
}
