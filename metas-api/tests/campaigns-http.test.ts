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
  CampaignDto,
  CampaignMutationInput,
  CampaignService,
} from '../src/modules/campaigns/campaign.types.js';
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
  campaigns = [initialCampaign];

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
      soldQuantity: 0,
      status: 'ATIVA',
      updatedAt: '2026-08-19T12:00:00.000Z',
    };
    this.campaigns.push(campaign);
    return Promise.resolve(campaign);
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

await test('manager creates and updates a campaign without quantity control', async () => {
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
