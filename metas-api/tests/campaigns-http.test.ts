import assert from 'node:assert/strict';
import test from 'node:test';

import request from 'supertest';
import { DatabaseError, type Sequelize } from 'sequelize';

import { createApp } from '../src/app.js';
import type {
  AuthenticatedSession,
  AuthenticationService,
  LoginResult,
  MeResult,
} from '../src/modules/auth/auth.types.js';
import type {
  CampaignDto,
  CampaignMutationInput,
  CampaignProgressEntryDto,
  CampaignProgressInput,
  CampaignProgressResultDto,
  CampaignService,
} from '../src/modules/campaigns/campaign.types.js';
import { PostgresCampaignService } from '../src/modules/campaigns/campaignService.js';
import type { RealtimeEventType, RealtimePublisher } from '../src/realtime/realtime.types.js';
import { AppError } from '../src/shared/errors/AppError.js';
import type { Logger } from '../src/shared/logging/logger.js';

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

const campaignInput: CampaignMutationInput = {
  endDate: '2026-08-31',
  name: 'Campanha de teste',
  startDate: '2026-08-01',
  targetAmountCents: '50000056',
  targetQuantity: 50,
};

const initialCampaign: CampaignDto = {
  ...campaignInput,
  createdAt: '2026-08-19T12:00:00.000Z',
  id: '018f47a1-3d11-7c14-a8bf-0242ac120006',
  lockVersion: 1,
  soldAmountCents: '0',
  soldQuantity: 0,
  status: 'ATIVA',
  updatedAt: '2026-08-19T12:00:00.000Z',
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

class FakeCampaignService implements CampaignService {
  campaigns = [{ ...initialCampaign }];
  progressEntries: CampaignProgressEntryDto[] = [];

  private requireManager(session: AuthenticatedSession): void {
    if (session.role !== 'GESTOR') {
      throw new AppError(403, 'FORBIDDEN', 'Você não tem permissão para realizar esta operação.');
    }
  }

  list(): Promise<CampaignDto[]> {
    return Promise.resolve(this.campaigns);
  }

  getById(_session: AuthenticatedSession, campaignId: string): Promise<CampaignDto> {
    const campaign = this.campaigns.find(({ id }) => id === campaignId);
    if (!campaign) throw new AppError(404, 'CAMPAIGN_NOT_FOUND', 'Campanha não encontrada.');
    return Promise.resolve(campaign);
  }

  create(session: AuthenticatedSession, input: CampaignMutationInput): Promise<CampaignDto> {
    this.requireManager(session);
    const campaign: CampaignDto = {
      ...input,
      createdAt: '2026-08-19T12:00:00.000Z',
      id: '018f47a1-3d11-7c14-a8bf-0242ac120007',
      lockVersion: 1,
      soldAmountCents: '0',
      soldQuantity: 0,
      status: 'ATIVA',
      updatedAt: '2026-08-19T12:00:00.000Z',
    };
    this.campaigns.push(campaign);
    return Promise.resolve(campaign);
  }

  createProgress(
    session: AuthenticatedSession,
    campaignId: string,
    input: CampaignProgressInput,
  ): Promise<CampaignProgressResultDto> {
    this.requireManager(session);
    const campaign = this.campaigns.find(({ id }) => id === campaignId);
    if (!campaign) throw new AppError(404, 'CAMPAIGN_NOT_FOUND', 'Campanha não encontrada.');
    if (campaign.targetQuantity === null && input.quantity !== null) {
      throw new AppError(
        422,
        'CAMPAIGN_QUANTITY_NOT_TRACKED',
        'Esta campanha não controla quantidade.',
      );
    }
    const entry: CampaignProgressEntryDto = {
      ...input,
      campaignId,
      createdAt: '2026-08-30T12:00:00.000Z',
      createdByName: 'Campaign Manager',
      createdByUserId: session.userId,
      id: `018f47a1-3d11-7c14-a8bf-${String(this.progressEntries.length + 1).padStart(12, '0')}`,
    };
    this.progressEntries.push(entry);
    campaign.soldAmountCents = String(BigInt(campaign.soldAmountCents) + BigInt(input.amountCents));
    if (campaign.soldQuantity !== null && input.quantity !== null) {
      campaign.soldQuantity += input.quantity;
    }
    return Promise.resolve({ campaign, entry });
  }

  listProgress(
    session: AuthenticatedSession,
    campaignId: string,
  ): Promise<CampaignProgressEntryDto[]> {
    this.requireManager(session);
    if (!this.campaigns.some(({ id }) => id === campaignId)) {
      throw new AppError(404, 'CAMPAIGN_NOT_FOUND', 'Campanha não encontrada.');
    }
    return Promise.resolve(this.progressEntries.filter((entry) => entry.campaignId === campaignId));
  }

  update(
    session: AuthenticatedSession,
    campaignId: string,
    input: CampaignMutationInput,
    expectedLockVersion: number,
  ): Promise<CampaignDto> {
    this.requireManager(session);
    const index = this.campaigns.findIndex(({ id }) => id === campaignId);
    if (index < 0) throw new AppError(404, 'CAMPAIGN_NOT_FOUND', 'Campanha não encontrada.');
    const campaign = this.campaigns[index];
    assert.ok(campaign);
    const updated = { ...campaign, ...input, lockVersion: expectedLockVersion + 1 };
    this.campaigns[index] = updated;
    return Promise.resolve(updated);
  }

  close(
    session: AuthenticatedSession,
    campaignId: string,
    expectedLockVersion: number,
  ): Promise<CampaignDto> {
    this.requireManager(session);
    const campaign = this.campaigns.find(({ id }) => id === campaignId);
    if (!campaign) throw new AppError(404, 'CAMPAIGN_NOT_FOUND', 'Campanha não encontrada.');
    campaign.status = 'ENCERRADA';
    campaign.lockVersion = expectedLockVersion + 1;
    return Promise.resolve(campaign);
  }
}

class RecordingRealtimePublisher implements RealtimePublisher {
  readonly events: Array<{ storeId: string; type: RealtimeEventType }> = [];
  publish(storeId: string, type: RealtimeEventType): void {
    this.events.push({ storeId, type });
  }
}

const silentLogger: Logger = { error: () => undefined, info: () => undefined };
const managerAuthorization = { Authorization: 'Bearer manager-token' };
const employeeAuthorization = { Authorization: 'Bearer employee-token' };

const createTestApp = () => {
  const campaignService = new FakeCampaignService();
  const realtimePublisher = new RecordingRealtimePublisher();
  return {
    app: createApp({
      authenticationService: new FakeAuthenticationService(),
      campaignService,
      logger: silentLogger,
      realtimePublisher,
    }),
    campaignService,
    realtimePublisher,
  };
};

await test('authenticated employees list store campaigns while manager routes require manager', async () => {
  const { app } = createTestApp();
  await request(app).get('/v1/campaigns').set(employeeAuthorization).expect(200);
  await request(app).get('/v1/manager/campaigns').set(managerAuthorization).expect(200);
  await request(app).get('/v1/manager/campaigns').set(employeeAuthorization).expect(403);
});

await test('manager creates, updates and closes a campaign with realtime invalidations', async () => {
  const { app, realtimePublisher } = createTestApp();
  const createdResponse = await request(app)
    .post('/v1/manager/campaigns')
    .set(managerAuthorization)
    .send(campaignInput)
    .expect(201);
  const created = createdResponse.body as CampaignDto;
  assert.equal(created.soldQuantity, 0);

  const updatedResponse = await request(app)
    .patch(`/v1/manager/campaigns/${created.id}`)
    .set(managerAuthorization)
    .send({
      ...campaignInput,
      expectedLockVersion: created.lockVersion,
      name: 'Campanha atualizada',
    })
    .expect(200);
  const updated = updatedResponse.body as CampaignDto;
  assert.equal(updated.name, 'Campanha atualizada');

  const closedResponse = await request(app)
    .patch(`/v1/manager/campaigns/${created.id}/close`)
    .set(managerAuthorization)
    .send({ expectedLockVersion: updated.lockVersion })
    .expect(200);
  assert.equal((closedResponse.body as CampaignDto).status, 'ENCERRADA');
  assert.deepEqual(realtimePublisher.events, [
    { storeId: managerSession.storeId, type: 'campaigns.changed' },
    { storeId: managerSession.storeId, type: 'campaigns.changed' },
    { storeId: managerSession.storeId, type: 'campaigns.changed' },
  ]);
});

await test('manager creates and updates campaigns with or without quantity control', async () => {
  const { app } = createTestApp();
  const createdResponse = await request(app)
    .post('/v1/manager/campaigns')
    .set(managerAuthorization)
    .send({ ...campaignInput, targetQuantity: null })
    .expect(201);
  const created = createdResponse.body as CampaignDto;
  assert.equal(created.targetQuantity, null);

  const updatedResponse = await request(app)
    .patch(`/v1/manager/campaigns/${created.id}`)
    .set(managerAuthorization)
    .send({ ...campaignInput, expectedLockVersion: created.lockVersion, targetQuantity: 25 })
    .expect(200);
  assert.equal((updatedResponse.body as CampaignDto).targetQuantity, 25);

  const disabledResponse = await request(app)
    .patch(`/v1/manager/campaigns/${created.id}`)
    .set(managerAuthorization)
    .send({ ...campaignInput, expectedLockVersion: 2, targetQuantity: null })
    .expect(200);
  assert.equal((disabledResponse.body as CampaignDto).targetQuantity, null);
});

await test('manager registers financial progress with optional quantity and publishes realtime', async () => {
  const { app, campaignService, realtimePublisher } = createTestApp();
  const amountOnly = await request(app)
    .post(`/v1/manager/campaigns/${initialCampaign.id}/progress`)
    .set(managerAuthorization)
    .send({ amountCents: '30000' })
    .expect(201);
  assert.equal((amountOnly.body as CampaignProgressResultDto).entry.quantity, null);
  assert.equal(campaignService.campaigns[0]?.soldAmountCents, '30000');
  assert.equal(campaignService.campaigns[0]?.soldQuantity, 0);

  await request(app)
    .post(`/v1/manager/campaigns/${initialCampaign.id}/progress`)
    .set(managerAuthorization)
    .send({ amountCents: '20000', quantity: 10 })
    .expect(201);
  assert.equal(campaignService.campaigns[0]?.soldAmountCents, '50000');
  assert.equal(campaignService.campaigns[0]?.soldQuantity, 10);

  const history = await request(app)
    .get(`/v1/manager/campaigns/${initialCampaign.id}/progress`)
    .set(managerAuthorization)
    .expect(200);
  assert.equal((history.body as CampaignProgressEntryDto[]).length, 2);
  assert.deepEqual(realtimePublisher.events, [
    { storeId: managerSession.storeId, type: 'campaigns.changed' },
    { storeId: managerSession.storeId, type: 'campaigns.changed' },
  ]);
});

await test('progress validation and campaign authorization reject inconsistent writes', async () => {
  const { app, campaignService, realtimePublisher } = createTestApp();
  campaignService.campaigns[0] = { ...initialCampaign, targetQuantity: null };
  await request(app)
    .post(`/v1/manager/campaigns/${initialCampaign.id}/progress`)
    .set(managerAuthorization)
    .send({ amountCents: '1000', quantity: 1 })
    .expect(422);
  await request(app)
    .post(`/v1/manager/campaigns/${initialCampaign.id}/progress`)
    .set(employeeAuthorization)
    .send({ amountCents: '1000' })
    .expect(403);
  for (const amountCents of ['', '0', '-1', '1.5', 1000]) {
    const response = await request(app)
      .post(`/v1/manager/campaigns/${initialCampaign.id}/progress`)
      .set(managerAuthorization)
      .send({ amountCents });
    assert.equal(response.status, 422, `amountCents inválido aceito: ${String(amountCents)}`);
  }
  for (const quantity of [0, -1, 1.5, '10']) {
    await request(app)
      .post(`/v1/manager/campaigns/${initialCampaign.id}/progress`)
      .set(managerAuthorization)
      .send({ amountCents: '1000', quantity })
      .expect(422);
  }
  assert.deepEqual(realtimePublisher.events, []);
});

await test('invalid, unknown and unauthorized campaign mutations are rejected', async () => {
  const { app, realtimePublisher } = createTestApp();
  await request(app)
    .post('/v1/manager/campaigns')
    .set(managerAuthorization)
    .send({ ...campaignInput, endDate: '2026-07-01', storeId: managerSession.storeId })
    .expect(422);
  await request(app)
    .post('/v1/manager/campaigns')
    .set(employeeAuthorization)
    .send(campaignInput)
    .expect(403);
  await request(app)
    .post('/v1/manager/campaigns')
    .set(managerAuthorization)
    .send({ ...campaignInput, targetQuantity: 0 })
    .expect(422);
  for (const targetQuantity of ['', -1, 1.5, '50']) {
    await request(app)
      .post('/v1/manager/campaigns')
      .set(managerAuthorization)
      .send({ ...campaignInput, targetQuantity })
      .expect(422);
  }
  const inputWithoutQuantity: Partial<CampaignMutationInput> = { ...campaignInput };
  delete inputWithoutQuantity.targetQuantity;
  await request(app)
    .post('/v1/manager/campaigns')
    .set(managerAuthorization)
    .send(inputWithoutQuantity)
    .expect(422);
  assert.deepEqual(realtimePublisher.events, []);
});

await test('failed campaign persistence does not publish realtime invalidation', async () => {
  const campaignService = new FakeCampaignService();
  campaignService.create = () =>
    Promise.reject(new AppError(409, 'CAMPAIGN_CONFLICT', 'Campaign conflict.'));
  const realtimePublisher = new RecordingRealtimePublisher();
  const app = createApp({
    authenticationService: new FakeAuthenticationService(),
    campaignService,
    logger: silentLogger,
    realtimePublisher,
  });

  await request(app)
    .post('/v1/manager/campaigns')
    .set(managerAuthorization)
    .send(campaignInput)
    .expect(409);
  assert.deepEqual(realtimePublisher.events, []);
});

await test('an outdated database does not turn null quantity into a false form error', async () => {
  const database = {
    query: (sql: string) => {
      if (sql.includes("set_config('app.current_user_id'")) return Promise.resolve([]);
      const parent = Object.assign(new Error('INVALID_CAMPAIGN'), { code: '22023', sql });
      return Promise.reject(new DatabaseError(parent));
    },
    transaction: async (callback: (transaction: object) => Promise<unknown>) => callback({}),
  } as unknown as Sequelize;
  const service = new PostgresCampaignService(database);

  await assert.rejects(
    service.create(managerSession, { ...campaignInput, targetQuantity: null }),
    (error: unknown) =>
      error instanceof AppError &&
      error.statusCode === 503 &&
      error.code === 'CAMPAIGN_QUANTITY_UNAVAILABLE',
  );
  await assert.rejects(
    service.create(managerSession, campaignInput),
    (error: unknown) =>
      error instanceof AppError && error.statusCode === 422 && error.code === 'INVALID_INPUT',
  );
});
