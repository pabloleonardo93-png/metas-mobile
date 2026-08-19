const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const Module = require('node:module');

const buildRoot = path.resolve('node_modules/.cache/calculation-tests');
const originalResolveFilename = Module._resolveFilename;

Module._resolveFilename = function resolveProjectAlias(request, parent, isMain, options) {
  const resolvedRequest = request.startsWith('@/')
    ? path.join(buildRoot, 'src', request.slice(2))
    : request;

  return originalResolveFilename.call(this, resolvedRequest, parent, isMain, options);
};

const {
  GoalConfigurationApiClient,
  GoalSessionUnavailableError,
} = require('../node_modules/.cache/calculation-tests/src/features/metas/services/goalConfigurationApiClient.js');
const {
  getGoalApiErrorMessage,
} = require('../node_modules/.cache/calculation-tests/src/features/metas/utils/goalApiError.js');
const {
  saveGoalConfigurationWithFeedback,
} = require('../node_modules/.cache/calculation-tests/src/features/metas/utils/saveGoalConfigurationFeedback.js');

const response = {
  id: '00000000-0000-4000-8000-000000000010',
  lockVersion: 2,
  month: '2026-08',
  monthlyTargetCents: '50000056',
  remainingBusinessDays: 12,
  roles: [
    { employeeCountSnapshot: 3, role: 'BALCONISTA', weight: '1.0000' },
    { employeeCountSnapshot: 1, role: 'FARMACEUTICO', weight: '0.7000' },
    { employeeCountSnapshot: 1, role: 'CAIXA', weight: '0.3000' },
  ],
  soldAmountCents: '125099',
  totalBusinessDays: 22,
};

function createHarness(overrides = {}) {
  const calls = [];
  const storage = { getToken: async () => (overrides.withoutToken ? null : 'session-token') };
  const request = async (path, options = {}) => {
    calls.push({ options, path });
    if (overrides.error) throw overrides.error;
    return overrides.response ?? response;
  };
  return { calls, client: new GoalConfigurationApiClient(request, storage) };
}

test('loads persisted goal configuration and preserves cents exactly', async () => {
  const harness = createHarness();
  const configuration = await harness.client.getConfiguration();
  assert.equal(configuration.monthlyTargetCents, 50000056);
  assert.equal(configuration.soldAmountCents, 125099);
  assert.equal(configuration.teamDistribution[0].quantity, 3);
  assert.equal(harness.calls[0].options.sessionToken, 'session-token');
});

test('saves cents and role weights without sending store or employee counts', async () => {
  const harness = createHarness();
  await harness.client.saveConfiguration(
    {
      monthlyTargetCents: 50000056,
      remainingBusinessDays: 12,
      soldAmountCents: 125099,
      teamDistribution: [
        { quantity: 99, role: 'BALCONISTA', weight: 1 },
        { quantity: 99, role: 'FARMACEUTICO', weight: 0.7 },
        { quantity: 99, role: 'CAIXA', weight: 0.3 },
      ],
      totalBusinessDays: 22,
    },
    1,
  );

  assert.equal(harness.calls[0].options.method, 'PUT');
  assert.deepEqual(harness.calls[0].options.body, {
    expectedLockVersion: 1,
    monthlyTargetCents: '50000056',
    remainingBusinessDays: 12,
    roleWeights: [
      { role: 'BALCONISTA', weight: '1' },
      { role: 'FARMACEUTICO', weight: '0.7' },
      { role: 'CAIXA', weight: '0.3' },
    ],
    soldAmountCents: '125099',
    totalBusinessDays: 22,
  });
  assert.equal('storeId' in harness.calls[0].options.body, false);
  assert.equal('quantity' in harness.calls[0].options.body.roleWeights[0], false);
});

test('failed save rejects and cannot be interpreted as success', async () => {
  const error = { code: 'NETWORK_ERROR', status: null };
  const harness = createHarness({ error });
  await assert.rejects(
    () =>
      harness.client.saveConfiguration(
        {
          monthlyTargetCents: 50000056,
          remainingBusinessDays: 12,
          soldAmountCents: 125099,
          teamDistribution: response.roles.map((role) => ({
            quantity: role.employeeCountSnapshot,
            role: role.role,
            weight: Number(role.weight),
          })),
          totalBusinessDays: 22,
        },
        1,
      ),
    (received) => received === error,
  );
  assert.match(getGoalApiErrorMessage(error), /conectar/u);
});

test('missing session prevents goal requests', async () => {
  const harness = createHarness({ withoutToken: true });
  await assert.rejects(() => harness.client.getConfiguration(), GoalSessionUnavailableError);
  assert.equal(harness.calls.length, 0);
});

test('first and second saves resolve and a later GET returns exact persisted cents', async () => {
  let persisted = { ...response, lockVersion: 1 };
  const request = async (_path, options = {}) => {
    if (options.method === 'PUT') {
      persisted = {
        ...persisted,
        lockVersion: persisted.lockVersion + 1,
        monthlyTargetCents: options.body.monthlyTargetCents,
        remainingBusinessDays: options.body.remainingBusinessDays,
        soldAmountCents: options.body.soldAmountCents,
        totalBusinessDays: options.body.totalBusinessDays,
      };
    }
    return persisted;
  };
  const client = new GoalConfigurationApiClient(request, {
    getToken: async () => 'session-token',
  });
  const input = {
    monthlyTargetCents: 50699392,
    remainingBusinessDays: 13,
    soldAmountCents: 25000065,
    teamDistribution: response.roles.map((role) => ({
      quantity: role.employeeCountSnapshot,
      role: role.role,
      weight: Number(role.weight),
    })),
    totalBusinessDays: 31,
  };

  const first = await client.saveConfiguration(input, 1);
  const second = await client.saveConfiguration({ ...input, soldAmountCents: 26000075 }, 2);
  const loaded = await client.getConfiguration();

  assert.equal(first.soldAmountCents, 25000065);
  assert.equal(second.soldAmountCents, 26000075);
  assert.equal(second.lockVersion, 3);
  assert.equal(loaded.monthlyTargetCents, 50699392);
  assert.equal(loaded.soldAmountCents, 26000075);
  assert.equal(loaded.remainingBusinessDays, 13);
  assert.equal(loaded.totalBusinessDays, 31);
});

test('save feedback distinguishes success from API failure', async () => {
  const success = await saveGoalConfigurationWithFeedback(async () => undefined);
  const failure = await saveGoalConfigurationWithFeedback(async () => {
    throw { code: 'NETWORK_ERROR', status: null };
  });

  assert.deepEqual(success, {
    message: 'Configura\u00e7\u00e3o salva com sucesso.',
    type: 'success',
  });
  assert.equal(failure.type, 'error');
  assert.match(failure.message, /conectar/u);
});
