import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import request from 'supertest';
import express from 'express';
import { createManagementRouter } from '../src/modules/platformManagement/management.routes.js';
import {
  managementError,
  type ManagementService,
} from '../src/modules/platformManagement/management.service.js';
import {
  employeeCreateInputSchema,
  employeeDeleteInputSchema,
  pharmacyInputSchema,
  employeeInputSchema,
} from '../src/modules/platformManagement/management.contracts.js';
import type {
  PlatformAdminAuthenticationService,
  PlatformAdminSession,
} from '../src/modules/platformAdmin/platformAdmin.types.js';
import { AppError } from '../src/shared/errors/AppError.js';
import { requestId } from '../src/middleware/requestId.js';
import { createErrorHandler } from '../src/middleware/errorHandler.js';

const id = '11111111-1111-4111-8111-111111111111';
const session: PlatformAdminSession = {
  platformAdminId: id,
  sessionId: id,
  assuranceLevel: 'MFA_VERIFIED',
  mfaVerifiedAt: null,
  expiresAt: '',
  stepUpVerifiedAt: new Date().toISOString(),
};
const setup = (
  assurance: PlatformAdminSession['assuranceLevel'] = 'MFA_VERIFIED',
  stepUpVerifiedAt: string | null = session.stepUpVerifiedAt,
  rateLimitAllowed = true,
) => {
  const creates: unknown[][] = [];
  const deletions: unknown[][] = [];
  const writes: unknown[][] = [];
  const lists: unknown[][] = [];
  const service: ManagementService = {
    createEmployee: (...args) => {
      creates.push(args);
      return Promise.resolve({ id });
    },
    deleteEmployee: (...args) => {
      deletions.push(args);
      return Promise.resolve({ id });
    },
    list: (...args) => {
      lists.push(args);
      return Promise.resolve({ items: [], total: 0, page: 1, pageSize: 20 });
    },
    write: (...args) => {
      writes.push(args);
      return Promise.resolve({ id });
    },
  };
  const authentication: PlatformAdminAuthenticationService = {
    authenticateSession: (token) => {
      if (token !== 'synthetic')
        return Promise.reject(new AppError(401, 'UNAUTHORIZED', 'Sessão necessária.'));
      return Promise.resolve({ ...session, assuranceLevel: assurance, stepUpVerifiedAt });
    },
    getMe: () => Promise.reject(new Error('not used')),
    loginWithGoogle: () => Promise.reject(new Error('not used')),
    logout: () => Promise.resolve(),
  };
  const app = express();
  app.use(express.json(), requestId);
  const rateLimiter = {
    consume: () => Promise.resolve({ allowed: rateLimitAllowed, retryAfterSeconds: 30 }),
  };
  app.use('/management', createManagementRouter(authentication, service, rateLimiter, 300));
  app.use(createErrorHandler({ error: () => {}, info: () => {} }));
  return { app, creates, deletions, writes, lists };
};
void test('gestão bloqueia ausência de sessão, token comum e Google-only antes do serviço', async () => {
  const { app, creates, deletions, lists, writes } = setup('GOOGLE_ONLY');
  assert.equal((await request(app).get('/management/pharmacies')).status, 401);
  assert.equal(
    (await request(app).get('/management/pharmacies').auth('employee', { type: 'bearer' })).status,
    401,
  );
  assert.equal(
    (await request(app).get('/management/pharmacies').auth('synthetic', { type: 'bearer' })).status,
    403,
  );
  assert.equal(
    (
      await request(app)
        .post('/management/pharmacies')
        .auth('synthetic', { type: 'bearer' })
        .send({})
    ).status,
    403,
  );
  assert.equal(
    (
      await request(app).post('/management/employees').auth('synthetic', { type: 'bearer' }).send({
        name: 'Pessoa Teste',
        email: 'pessoa@example.test',
        storeId: id,
        role: 'GESTOR',
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request(app)
        .delete('/management/employees/' + id)
        .auth('synthetic', { type: 'bearer' })
        .send({ version: 1, userVersion: 1 })
    ).status,
    403,
  );
  assert.equal(creates.length + deletions.length + lists.length + writes.length, 0);
});
void test('gestão lista com filtros validados e transmite contexto administrativo', async () => {
  const { app, lists } = setup();
  const result = await request(app)
    .get('/management/employees?q=Pessoa&status=ACTIVE&role=GESTOR&page=2')
    .auth('synthetic', { type: 'bearer' });
  assert.equal(result.status, 200);
  assert.equal(result.headers['cache-control'], 'no-store');
  assert.deepEqual(lists[0], [
    session,
    'employees',
    { q: 'Pessoa', status: 'ACTIVE', role: 'GESTOR', page: 2, pageSize: 20 },
  ]);
  assert.equal(
    (
      await request(app)
        .get('/management/employees?role=PLATFORM_ADMIN')
        .auth('synthetic', { type: 'bearer' })
    ).status,
    422,
  );
  assert.equal(
    (
      await request(app)
        .get('/management/pharmacies?pageSize=999')
        .auth('synthetic', { type: 'bearer' })
    ).status,
    422,
  );
});
void test('gestão cria farmácia, edita vínculo e valida IDs', async () => {
  const { app, writes } = setup();
  const store = {
    name: 'Farmácia Centro',
    slug: 'centro',
    timezone: 'America/Sao_Paulo',
    isActive: true,
  };
  assert.equal(
    (
      await request(app)
        .post('/management/pharmacies')
        .auth('synthetic', { type: 'bearer' })
        .send(store)
    ).status,
    201,
  );
  assert.equal(writes[0]?.[1], 'savePharmacy');
  assert.equal(writes[0]?.[2], null);
  const employee = {
    name: 'Pessoa Teste',
    role: 'CAIXA',
    status: 'INATIVO',
    version: 1,
    userVersion: 1,
  };
  assert.equal(
    (
      await request(app)
        .post('/management/employees/' + id)
        .auth('synthetic', { type: 'bearer' })
        .send(employee)
    ).status,
    200,
  );
  assert.equal(
    (
      await request(app)
        .post('/management/employees/' + id + '/link')
        .auth('synthetic', { type: 'bearer' })
        .send({ storeId: id, role: 'GESTOR' })
    ).status,
    201,
  );
  assert.equal(
    (
      await request(app)
        .post('/management/employees/invalid')
        .auth('synthetic', { type: 'bearer' })
        .send(employee)
    ).status,
    422,
  );
  assert.equal(
    (
      await request(app)
        .delete('/management/pharmacies/' + id)
        .auth('synthetic', { type: 'bearer' })
    ).status,
    404,
  );
});
void test('exclusão exige step-up recente e contrato estrito', async () => {
  const input = { version: 1, userVersion: 2 };
  const { app, deletions } = setup();
  const response = await request(app)
    .delete('/management/employees/' + id)
    .auth('synthetic', { type: 'bearer' })
    .send(input);
  assert.equal(response.status, 200);
  assert.deepEqual(deletions[0]?.slice(0, 3), [session, id, input]);

  for (const invalid of [
    { version: 0, userVersion: 2 },
    { version: 1 },
    { ...input, unexpected: true },
  ]) {
    assert.equal(
      (
        await request(app)
          .delete('/management/employees/' + id)
          .auth('synthetic', { type: 'bearer' })
          .send(invalid)
      ).status,
      422,
    );
  }
  assert.equal(
    (
      await request(app)
        .delete('/management/employees/invalid')
        .auth('synthetic', { type: 'bearer' })
        .send(input)
    ).status,
    422,
  );

  const stale = setup('MFA_VERIFIED', new Date(Date.now() - 301_000).toISOString());
  assert.equal(
    (
      await request(stale.app)
        .delete('/management/employees/' + id)
        .auth('synthetic', { type: 'bearer' })
        .send(input)
    ).status,
    403,
  );
  assert.equal(stale.deletions.length, 0);

  const limited = setup('MFA_VERIFIED', session.stepUpVerifiedAt, false);
  const limitedResponse = await request(limited.app)
    .delete('/management/employees/' + id)
    .auth('synthetic', { type: 'bearer' })
    .send(input);
  assert.equal(limitedResponse.status, 429);
  assert.equal(limitedResponse.headers['retry-after'], '30');
  assert.equal(limited.deletions.length, 0);
});
void test('criação de pessoa exige step-up recente, valida contrato estrito e usa caso de uso único', async () => {
  const input = {
    name: 'Pessoa Teste',
    email: 'pessoa@example.test',
    storeId: id,
    role: 'GESTOR',
  };
  const { app, creates } = setup();
  const created = await request(app)
    .post('/management/employees')
    .auth('synthetic', { type: 'bearer' })
    .send(input);
  assert.equal(created.status, 201);
  assert.deepEqual(creates[0]?.slice(0, 2), [session, input]);

  for (const invalid of [
    { ...input, email: 'invalido' },
    { ...input, role: 'SUPERUSER' },
    { ...input, unexpected: true },
  ]) {
    assert.equal(
      (
        await request(app)
          .post('/management/employees')
          .auth('synthetic', { type: 'bearer' })
          .send(invalid)
      ).status,
      422,
    );
  }

  const stale = setup('MFA_VERIFIED', new Date(Date.now() - 301_000).toISOString());
  assert.equal(
    employeeDeleteInputSchema.safeParse({ version: 1, userVersion: 1, employeeId: id }).success,
    false,
  );
  assert.equal(
    (
      await request(stale.app)
        .post('/management/employees')
        .auth('synthetic', { type: 'bearer' })
        .send(input)
    ).status,
    403,
  );
  assert.equal(stale.creates.length, 0);
});
void test('gestão rejeita mass assignment, role arbitrário, versão ausente, fuso e slug inválidos', () => {
  assert.equal(
    employeeInputSchema.safeParse({
      name: 'Pessoa',
      role: 'SUPERUSER',
      status: 'ATIVO',
      version: 1,
      userVersion: 1,
    }).success,
    false,
  );
  assert.equal(
    employeeCreateInputSchema.safeParse({
      name: 'Pessoa',
      email: 'pessoa@example.test',
      storeId: id,
      role: 'GESTOR',
      userId: id,
    }).success,
    false,
  );
  assert.equal(
    employeeInputSchema.safeParse({ name: 'Pessoa', role: 'GESTOR', status: 'ATIVO' }).success,
    false,
  );
  assert.equal(
    pharmacyInputSchema.safeParse({
      name: 'Teste',
      slug: 'invalid slug',
      timezone: 'Unknown',
      isActive: true,
    }).success,
    false,
  );
  assert.equal(
    employeeInputSchema.safeParse({
      name: 'Pessoa',
      role: 'GESTOR',
      status: 'ATIVO',
      version: 1,
      userVersion: 1,
      userId: id,
    }).success,
    false,
  );
});
void test('erros SQL conhecidos usam allowlist e erros desconhecidos não expõem SQL, segredo ou driver', () => {
  assert.equal(
    managementError({ parent: { message: 'LAST_ACTIVE_MANAGER_REQUIRED' } }).code,
    'LAST_ACTIVE_MANAGER_REQUIRED',
  );
  assert.equal(
    managementError({ parent: { message: 'LAST_ACTIVE_MANAGER_DELETE_REQUIRED' } }).message,
    'Não é possível excluir o único gestor ativo desta farmácia.',
  );
  assert.equal(
    managementError({ parent: { message: 'MANAGEMENT_EMPLOYEE_ALREADY_DELETED' } }).message,
    'O funcionário já foi excluído.',
  );
  const result = managementError({
    parent: { message: 'password=synthetic-secret SQL host=private', code: 'random-secret' },
  });
  assert.equal(result.code, 'MANAGEMENT_UNAVAILABLE');
  assert.doesNotMatch(JSON.stringify(result), /synthetic-secret|private|random-secret/u);
});

void test('contratos de gestão dos três workspaces permanecem equivalentes', () => {
  const read = (relative: string) =>
    readFileSync(new URL(relative, import.meta.url), 'utf8')
      .replace(/\r\n/gu, '\n')
      .trim();
  const api = read('../src/modules/platformManagement/management.contracts.ts');
  assert.equal(read('../../metas-admin/bff/src/routes/management.contracts.ts'), api);
  assert.equal(read('../../metas-admin/frontend/src/api/management.contracts.ts'), api);
});
