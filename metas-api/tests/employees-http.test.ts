import assert from 'node:assert/strict';
import test from 'node:test';

import request from 'supertest';

import { createApp } from '../src/app.js';
import type {
  AuthenticatedSession,
  AuthenticationService,
  LoginResult,
  MeResult,
} from '../src/modules/auth/auth.types.js';
import type {
  EmployeeDto,
  EmployeeMutationInput,
  EmployeeService,
  EmployeeStatus,
} from '../src/modules/employees/employee.types.js';
import { AppError } from '../src/shared/errors/AppError.js';
import type { Logger } from '../src/shared/logging/logger.js';
import type { RealtimeEventType, RealtimePublisher } from '../src/realtime/realtime.types.js';

const managerSession: AuthenticatedSession = {
  employeeId: '018f47a1-3d11-7c14-a8bf-0242ac120003',
  role: 'GESTOR',
  storeId: '018f47a1-3d11-7c14-a8bf-0242ac120002',
  tokenHash: Buffer.alloc(32),
  userId: '018f47a1-3d11-7c14-a8bf-0242ac120001',
};

const employeeSession: AuthenticatedSession = {
  ...managerSession,
  employeeId: '018f47a1-3d11-7c14-a8bf-0242ac120004',
  role: 'CAIXA',
  tokenHash: Buffer.alloc(32, 1),
  userId: '018f47a1-3d11-7c14-a8bf-0242ac120005',
};

const initialEmployee: EmployeeDto = {
  email: 'ana@example.test',
  id: '018f47a1-3d11-7c14-a8bf-0242ac120006',
  joinedOn: '2026-08-01',
  name: 'Ana Souza',
  role: 'BALCONISTA',
  status: 'ATIVO',
};

class FakeAuthenticationService implements AuthenticationService {
  authenticateSession(token: string): Promise<AuthenticatedSession> {
    if (token === 'manager-token') return Promise.resolve(managerSession);
    if (token === 'employee-token') return Promise.resolve(employeeSession);
    throw new AppError(401, 'UNAUTHORIZED', 'Autenticação necessária.');
  }

  getMe(): Promise<MeResult> {
    throw new Error('Not used');
  }

  loginWithGoogle(): Promise<LoginResult> {
    throw new Error('Not used');
  }

  logout(): Promise<void> {
    throw new Error('Not used');
  }

  refreshSession(session: AuthenticatedSession): Promise<AuthenticatedSession> {
    return Promise.resolve(session);
  }
}

class FakeEmployeeService implements EmployeeService {
  employees = [initialEmployee];

  private requireManager(session: AuthenticatedSession): void {
    if (session.role !== 'GESTOR') {
      throw new AppError(403, 'FORBIDDEN', 'Você não tem permissão para realizar esta operação.');
    }
  }

  create(session: AuthenticatedSession, input: EmployeeMutationInput): Promise<EmployeeDto> {
    this.requireManager(session);
    const employee = { ...input, id: '018f47a1-3d11-7c14-a8bf-0242ac120007' };
    this.employees.push(employee);
    return Promise.resolve(employee);
  }

  getById(session: AuthenticatedSession, employeeId: string): Promise<EmployeeDto> {
    this.requireManager(session);
    const employee = this.employees.find((item) => item.id === employeeId);
    if (!employee) throw new AppError(404, 'EMPLOYEE_NOT_FOUND', 'Funcionário não encontrado.');
    return Promise.resolve(employee);
  }

  list(session: AuthenticatedSession): Promise<EmployeeDto[]> {
    this.requireManager(session);
    return Promise.resolve(this.employees);
  }

  setStatus(
    session: AuthenticatedSession,
    employeeId: string,
    status: EmployeeStatus,
  ): Promise<EmployeeDto> {
    this.requireManager(session);
    const employee = this.employees.find((item) => item.id === employeeId);
    if (!employee) throw new AppError(404, 'EMPLOYEE_NOT_FOUND', 'Funcionário não encontrado.');
    employee.status = status;
    return Promise.resolve(employee);
  }

  update(
    session: AuthenticatedSession,
    employeeId: string,
    input: EmployeeMutationInput,
  ): Promise<EmployeeDto> {
    this.requireManager(session);
    const index = this.employees.findIndex((item) => item.id === employeeId);
    if (index < 0) throw new AppError(404, 'EMPLOYEE_NOT_FOUND', 'Funcionário não encontrado.');
    const employee = { ...input, id: employeeId };
    this.employees[index] = employee;
    return Promise.resolve(employee);
  }
}

const silentLogger: Logger = { error: () => undefined, info: () => undefined };

class RecordingRealtimePublisher implements RealtimePublisher {
  readonly events: Array<{ storeId: string; type: RealtimeEventType }> = [];

  publish(storeId: string, type: RealtimeEventType): void {
    this.events.push({ storeId, type });
  }
}

const parseJson = <Result extends object>(text: string): Result => {
  const value: unknown = JSON.parse(text);
  assert.equal(typeof value, 'object');
  assert.notEqual(value, null);
  return value as Result;
};

const createTestApp = () => {
  const employeeService = new FakeEmployeeService();
  const realtimePublisher = new RecordingRealtimePublisher();
  return {
    app: createApp({
      authenticationService: new FakeAuthenticationService(),
      employeeService,
      logger: silentLogger,
      realtimePublisher,
    }),
    employeeService,
    realtimePublisher,
  };
};

const authorization = { Authorization: 'Bearer manager-token' };

await test('manager lists employees and fetches details', async () => {
  const { app } = createTestApp();
  const list = await request(app).get('/v1/manager/employees').set(authorization).expect(200);
  assert.deepEqual(list.body, [initialEmployee]);

  const details = await request(app)
    .get(`/v1/manager/employees/${initialEmployee.id}`)
    .set(authorization)
    .expect(200);
  assert.deepEqual(details.body, initialEmployee);
});

await test('manager creates, edits and changes employee status', async () => {
  const { app, realtimePublisher } = createTestApp();
  const input: EmployeeMutationInput = {
    email: 'carlos@example.test',
    joinedOn: '2026-08-13',
    name: 'Carlos Silva',
    role: 'CAIXA',
    status: 'ATIVO',
  };
  const created = await request(app)
    .post('/v1/manager/employees')
    .set(authorization)
    .send(input)
    .expect(201);
  const createdBody = parseJson<EmployeeDto>(created.text);
  assert.equal(createdBody.email, input.email);

  const updated = await request(app)
    .patch(`/v1/manager/employees/${createdBody.id}`)
    .set(authorization)
    .send({ ...input, name: 'Carlos Eduardo', role: 'FARMACEUTICO' })
    .expect(200);
  const updatedBody = parseJson<EmployeeDto>(updated.text);
  assert.equal(updatedBody.role, 'FARMACEUTICO');

  const inactive = await request(app)
    .patch(`/v1/manager/employees/${createdBody.id}/status`)
    .set(authorization)
    .send({ status: 'INATIVO' })
    .expect(200);
  assert.equal(parseJson<EmployeeDto>(inactive.text).status, 'INATIVO');
  assert.deepEqual(realtimePublisher.events, [
    { storeId: managerSession.storeId, type: 'employees.changed' },
    { storeId: managerSession.storeId, type: 'employees.changed' },
    { storeId: managerSession.storeId, type: 'employees.changed' },
  ]);
});

await test('authentication and manager role are required', async () => {
  const { app } = createTestApp();
  await request(app).get('/v1/manager/employees').expect(401);
  await request(app)
    .get('/v1/manager/employees')
    .set({ Authorization: 'Bearer employee-token' })
    .expect(403);
});

await test('strict validation rejects invalid and unknown input', async () => {
  const { app, realtimePublisher } = createTestApp();
  const response = await request(app)
    .post('/v1/manager/employees')
    .set(authorization)
    .send({
      email: 'invalid',
      joinedOn: '2099-01-01',
      name: '',
      role: 'ADMIN',
      status: 'ATIVO',
      storeId: managerSession.storeId,
    })
    .expect(422);
  assert.equal(parseJson<{ code: string }>(response.text).code, 'INVALID_INPUT');
  assert.deepEqual(realtimePublisher.events, []);
});

await test('failed employee mutations do not publish realtime invalidations', async () => {
  const employeeService = new FakeEmployeeService();
  employeeService.create = () =>
    Promise.reject(new AppError(409, 'EMPLOYEE_ALREADY_EXISTS', 'Employee already exists.'));
  const realtimePublisher = new RecordingRealtimePublisher();
  const app = createApp({
    authenticationService: new FakeAuthenticationService(),
    employeeService,
    logger: silentLogger,
    realtimePublisher,
  });

  await request(app)
    .post('/v1/manager/employees')
    .set(authorization)
    .send({
      email: 'duplicate@example.test',
      joinedOn: '2026-08-13',
      name: 'Duplicate Employee',
      role: 'CAIXA',
      status: 'ATIVO',
    })
    .expect(409);
  assert.deepEqual(realtimePublisher.events, []);
});
