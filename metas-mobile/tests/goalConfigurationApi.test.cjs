const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  GoalConfigurationApiClient,
  GoalSessionUnavailableError,
} = require('../node_modules/.cache/calculation-tests/src/features/metas/services/goalConfigurationApiClient.js');
const {
  getGoalApiErrorMessage,
} = require('../node_modules/.cache/calculation-tests/src/features/metas/utils/goalApiError.js');

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
