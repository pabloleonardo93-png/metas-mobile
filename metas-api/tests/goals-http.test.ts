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
  GoalService,
  ManagerGoalConfigurationDto,
  SaveManagerGoalConfigurationInput,
} from '../src/modules/goals/goal.types.js';
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

const configuration: ManagerGoalConfigurationDto = {
  id: '018f47a1-3d11-7c14-a8bf-0242ac120010',
  lockVersion: 1,
  month: '2026-08',
  monthlyTargetCents: '50000056',
  remainingBusinessDays: 20,
  roles: [
    { employeeCountSnapshot: 3, role: 'BALCONISTA', weight: '1.0000' },
    { employeeCountSnapshot: 1, role: 'FARMACEUTICO', weight: '0.7000' },
    { employeeCountSnapshot: 1, role: 'CAIXA', weight: '0.3000' },
  ],
  soldAmountCents: '12000050',
  totalBusinessDays: 26,
};

class FakeAuthenticationService implements AuthenticationService {
  authenticateSession(token: string): Promise<AuthenticatedSession> {
    if (token === 'manager-token') return Promise.resolve(managerSession);
    if (token === 'employee-token') {
      return Promise.resolve({ ...managerSession, role: 'CAIXA' });
    }
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

class FakeGoalService implements GoalService {
  current = configuration;

  getConfiguration(session: AuthenticatedSession): Promise<ManagerGoalConfigurationDto> {
    this.requireManager(session);
    return Promise.resolve(this.current);
  }

  saveConfiguration(
    session: AuthenticatedSession,
    input: SaveManagerGoalConfigurationInput,
  ): Promise<ManagerGoalConfigurationDto> {
    this.requireManager(session);
    this.current = {
      ...this.current,
      lockVersion: (this.current.lockVersion ?? 0) + 1,
      monthlyTargetCents: input.monthlyTargetCents,
      remainingBusinessDays: input.remainingBusinessDays,
      roles: input.roleWeights.map(({ role, weight }) => ({
        employeeCountSnapshot: 1,
        role,
        weight,
      })),
      soldAmountCents: input.soldAmountCents,
      totalBusinessDays: input.totalBusinessDays,
    };
    return Promise.resolve(this.current);
  }

  private requireManager(session: AuthenticatedSession): void {
    if (session.role !== 'GESTOR') {
      throw new AppError(403, 'FORBIDDEN', 'Você não tem permissão para realizar esta operação.');
    }
  }
}

const input: SaveManagerGoalConfigurationInput = {
  expectedLockVersion: 1,
  monthlyTargetCents: '50000056',
  remainingBusinessDays: 20,
  roleWeights: [
    { role: 'BALCONISTA', weight: '1.0' },
    { role: 'FARMACEUTICO', weight: '0.7' },
    { role: 'CAIXA', weight: '0.3' },
  ],
  soldAmountCents: '12000050',
  totalBusinessDays: 26,
};

const silentLogger: Logger = { error: () => undefined, info: () => undefined };
class RecordingRealtimePublisher implements RealtimePublisher {
  readonly events: Array<{ storeId: string; type: RealtimeEventType }> = [];
  publish(storeId: string, type: RealtimeEventType): void {
    this.events.push({ storeId, type });
  }
}
const authorization = { Authorization: 'Bearer manager-token' };
const parseJson = <Result extends object>(text: string): Result => JSON.parse(text) as Result;
const createTestApp = () => {
  const realtimePublisher = new RecordingRealtimePublisher();
  return {
    app: createApp({
      authenticationService: new FakeAuthenticationService(),
      goalService: new FakeGoalService(),
      logger: silentLogger,
      realtimePublisher,
    }),
    realtimePublisher,
  };
};

await test('manager loads and saves goal configuration preserving cents', async () => {
  const { app, realtimePublisher } = createTestApp();
  const loaded = await request(app)
    .get('/v1/manager/goals/configuration')
    .set(authorization)
    .expect(200);
  assert.equal(parseJson<ManagerGoalConfigurationDto>(loaded.text).monthlyTargetCents, '50000056');

  const saved = await request(app)
    .put('/v1/manager/goals/configuration')
    .set(authorization)
    .send(input)
    .expect(200);
  const savedBody = parseJson<ManagerGoalConfigurationDto>(saved.text);
  assert.equal(savedBody.monthlyTargetCents, '50000056');
  assert.equal(savedBody.soldAmountCents, '12000050');
  assert.deepEqual(realtimePublisher.events, [
    { storeId: managerSession.storeId, type: 'goal.configuration.changed' },
  ]);
});

await test('goal configuration accepts sold amounts below, equal to, and above target', async () => {
  const soldAmounts = ['25000000', '50050500', '60000000', '250506556'];

  for (const soldAmountCents of soldAmounts) {
    const response = await request(createTestApp().app)
      .put('/v1/manager/goals/configuration')
      .set(authorization)
      .send({
        ...input,
        monthlyTargetCents: '50050500',
        soldAmountCents,
      })
      .expect(200);
    const body = parseJson<ManagerGoalConfigurationDto>(response.text);
    assert.equal(body.monthlyTargetCents, '50050500');
    assert.equal(body.soldAmountCents, soldAmountCents);
  }
});

await test('goal configuration requires manager authorization', async () => {
  const { app } = createTestApp();
  await request(app).get('/v1/manager/goals/configuration').expect(401);
  await request(app)
    .put('/v1/manager/goals/configuration')
    .set({ Authorization: 'Bearer employee-token' })
    .send(input)
    .expect(403);
});

await test('strict validation rejects invalid values and manipulated fields', async () => {
  const { app, realtimePublisher } = createTestApp();
  const response = await request(app)
    .put('/v1/manager/goals/configuration')
    .set(authorization)
    .send({
      ...input,
      monthlyTargetCents: '-1',
      remainingBusinessDays: 32,
      storeId: managerSession.storeId,
    })
    .expect(422);
  assert.equal(parseJson<{ code: string }>(response.text).code, 'INVALID_INPUT');
  assert.deepEqual(realtimePublisher.events, []);
});
