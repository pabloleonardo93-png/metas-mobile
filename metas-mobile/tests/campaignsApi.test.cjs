const assert = require('node:assert/strict');
const fs = require('node:fs');
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
  CampaignApiClient,
  CampaignSessionUnavailableError,
  InvalidCampaignResponseError,
} = require('../node_modules/.cache/calculation-tests/src/features/campaigns/services/campaignApiClient.js');
const {
  campaignsReducer,
  initialCampaignsState,
} = require('../node_modules/.cache/calculation-tests/src/features/campaigns/state/campaignsState.js');
const {
  countActiveCampaigns,
  calculateCampaignMetrics,
  filterCampaigns,
} = require('../node_modules/.cache/calculation-tests/src/features/campaigns/utils/campaign.utils.js');
const {
  validateCampaignForm,
} = require('../node_modules/.cache/calculation-tests/src/features/campaigns/utils/validateCampaignForm.js');
const {
  changeCampaignQuantityControl,
} = require('../node_modules/.cache/calculation-tests/src/features/campaigns/utils/campaignFormValues.js');

const responseCampaign = {
  createdAt: '2026-08-19T12:00:00.000Z',
  endDate: '2026-08-31',
  id: '00000000-0000-4000-8000-000000000020',
  lockVersion: 1,
  name: 'Campanha real',
  soldAmountCents: '0',
  soldQuantity: 0,
  startDate: '2026-08-01',
  status: 'ATIVA',
  targetAmountCents: '50000056',
  targetQuantity: 50,
  updatedAt: '2026-08-19T12:00:00.000Z',
};

function createHarness(overrides = {}) {
  const calls = [];
  const request = async (path, options = {}) => {
    calls.push({ options, path });
    if (overrides.error) throw overrides.error;
    if (path.endsWith('/progress')) {
      if (options.method === undefined) return overrides.progressList ?? [];
      return overrides.progressResponse;
    }
    if (options.method === undefined) return overrides.list ?? [responseCampaign];
    return { ...responseCampaign, ...(overrides.response ?? {}) };
  };
  return {
    calls,
    client: new CampaignApiClient(request, {
      getToken: async () => (overrides.withoutToken ? null : 'session-token'),
    }),
  };
}

const campaignInput = {
  endDate: '2026-08-31',
  name: 'Campanha real',
  startDate: '2026-08-01',
  targetAmountCents: 50000056,
  targetQuantity: 50,
};

test('campaign state covers loading, empty API result and immediate upsert without duplicates', () => {
  const loading = campaignsReducer(initialCampaignsState, { type: 'loadStarted' });
  assert.equal(loading.status, 'loading');
  const empty = campaignsReducer(loading, { campaigns: [], type: 'loadSucceeded' });
  assert.equal(empty.status, 'ready');
  assert.deepEqual(empty.campaigns, []);

  const campaign = { ...responseCampaign, targetAmountCents: 50000056 };
  const created = campaignsReducer(empty, { campaign, type: 'upserted' });
  const updated = campaignsReducer(created, {
    campaign: { ...campaign, lockVersion: 2, name: 'Campanha atualizada' },
    type: 'upserted',
  });
  assert.equal(updated.campaigns.length, 1);
  assert.equal(updated.campaigns[0].name, 'Campanha atualizada');
});

test('manager and employee campaign lists use authenticated role-specific routes', async () => {
  const harness = createHarness();
  const managerCampaigns = await harness.client.list(true);
  const employeeCampaigns = await harness.client.list(false);
  assert.equal(managerCampaigns[0].targetAmountCents, 50000056);
  assert.equal(employeeCampaigns[0].soldQuantity, 0);
  assert.equal(harness.calls[0].path, '/v1/manager/campaigns');
  assert.equal(harness.calls[1].path, '/v1/campaigns');
  assert.equal(harness.calls[0].options.sessionToken, 'session-token');
});

test('create, update and close send cents, lock version and no store identifier', async () => {
  const harness = createHarness();
  const created = await harness.client.create(campaignInput);
  const updated = await harness.client.update(created, { ...campaignInput, name: 'Atualizada' });
  await harness.client.close(updated);

  assert.deepEqual(harness.calls[0].options.body, {
    ...campaignInput,
    targetAmountCents: '50000056',
  });
  assert.equal('storeId' in harness.calls[0].options.body, false);
  assert.equal(harness.calls[1].options.body.expectedLockVersion, created.lockVersion);
  assert.deepEqual(harness.calls[2].options.body, {
    expectedLockVersion: updated.lockVersion,
  });
  assert.match(harness.calls[2].path, /\/close$/u);
});

test('campaign without quantity sends and receives an explicit null target', async () => {
  const harness = createHarness({ response: { targetQuantity: null } });
  const created = await harness.client.create({ ...campaignInput, targetQuantity: null });

  assert.equal(created.targetQuantity, null);
  assert.equal(harness.calls[0].options.body.targetQuantity, null);
  assert.deepEqual(calculateCampaignMetrics(created), {
    financialProgress: 0,
    quantity: null,
    soldAmountCents: 0,
    targetAmountCents: 50000056,
  });
});

test('campaign progress sends integer cents with optional quantity and parses history', async () => {
  const progressResponse = {
    amountCents: '30000',
    campaignId: responseCampaign.id,
    createdAt: '2026-08-30T12:00:00.000Z',
    createdByName: 'Gestor da loja',
    createdByUserId: '00000000-0000-4000-8000-000000000030',
    id: '00000000-0000-4000-8000-000000000031',
    quantity: null,
  };
  const harness = createHarness({
    progressList: [progressResponse],
    progressResponse: {
      campaign: { ...responseCampaign, soldAmountCents: '30000' },
      entry: progressResponse,
    },
  });
  const created = await harness.client.createProgress(responseCampaign.id, {
    amountCents: 30000,
    quantity: null,
  });
  const history = await harness.client.listProgress(responseCampaign.id);

  assert.equal(created.entry.amountCents, 30000);
  assert.equal(created.campaign.soldAmountCents, 30000);
  assert.equal(history[0].quantity, null);
  assert.deepEqual(harness.calls[0].options.body, { amountCents: '30000', quantity: null });
  assert.equal(harness.calls[0].path, `/v1/manager/campaigns/${responseCampaign.id}/progress`);
});

test('financial metrics remain valid with no quantity and cap visual progress above target', () => {
  const metrics = calculateCampaignMetrics({
    ...responseCampaign,
    soldAmountCents: 180000,
    soldQuantity: null,
    targetAmountCents: 400000,
    targetQuantity: null,
  });
  assert.equal(metrics.soldAmountCents, 180000);
  assert.equal(metrics.financialProgress, 45);
  assert.equal(metrics.quantity, null);
  assert.equal(Number.isFinite(metrics.financialProgress), true);

  const exceeded = calculateCampaignMetrics({
    ...responseCampaign,
    soldAmountCents: 450000,
    targetAmountCents: 400000,
  });
  assert.equal(exceeded.soldAmountCents, 450000);
  assert.equal(exceeded.financialProgress, 100);
});

test('progress form makes quantity optional and guards against duplicate submission', () => {
  const source = fs.readFileSync(
    path.resolve('src/features/campaigns/components/CampaignProgressForm.tsx'),
    'utf8',
  );
  assert.match(source, /allowsQuantity \? \([\s\S]*Informar quantidade vendida/u);
  assert.match(source, /allowsQuantity && includeQuantity \? \([\s\S]*Quantidade vendida/u);
  assert.match(source, /if \(submissionLockRef\.current\) return;/u);
  assert.match(source, /submissionLockRef\.current = true;/u);
  assert.match(source, /quantity: allowsQuantity && includeQuantity \? Number\(quantity\) : null/u);
});

test('quantity is required only when quantity control is enabled', () => {
  const values = {
    endDate: '31/08/2026',
    name: 'Campanha real',
    startDate: '01/08/2026',
    targetAmount: '5.000,00',
    targetQuantity: '',
    usesQuantity: true,
  };

  assert.equal(validateCampaignForm(values).targetQuantity, 'Informe a quantidade a vender.');
  assert.equal(validateCampaignForm({ ...values, usesQuantity: false }).targetQuantity, undefined);
  assert.equal(validateCampaignForm({ ...values, targetQuantity: '50' }).targetQuantity, undefined);
});

test('disabling quantity clears the previous value and enabling it again requires a new value', () => {
  const values = {
    endDate: '31/08/2026',
    name: 'Campanha real',
    startDate: '01/08/2026',
    targetAmount: '5.000,00',
    targetQuantity: '50',
    usesQuantity: true,
  };

  const disabled = changeCampaignQuantityControl(values, false);
  assert.equal(disabled.usesQuantity, false);
  assert.equal(disabled.targetQuantity, '');
  assert.equal(validateCampaignForm(disabled).targetQuantity, undefined);

  const enabledAgain = changeCampaignQuantityControl(disabled, true);
  assert.equal(enabledAgain.usesQuantity, true);
  assert.equal(enabledAgain.targetQuantity, '');
  assert.equal(validateCampaignForm(enabledAgain).targetQuantity, 'Informe a quantidade a vender.');
});

test('missing session and invalid money response fail safely', async () => {
  const withoutToken = createHarness({ withoutToken: true });
  await assert.rejects(() => withoutToken.client.list(true), CampaignSessionUnavailableError);
  assert.equal(withoutToken.calls.length, 0);

  const invalidMoney = createHarness({ list: [{ ...responseCampaign, targetAmountCents: '1.5' }] });
  await assert.rejects(() => invalidMoney.client.list(true), InvalidCampaignResponseError);
  const invalidSoldMoney = createHarness({
    list: [{ ...responseCampaign, soldAmountCents: '-1' }],
  });
  await assert.rejects(() => invalidSoldMoney.client.list(true), InvalidCampaignResponseError);
});

test('campaign filters and active count use only real API state', () => {
  const campaigns = [
    { ...responseCampaign, targetAmountCents: 50000056 },
    {
      ...responseCampaign,
      id: '00000000-0000-4000-8000-000000000021',
      name: 'Campanha futura',
      status: 'AGENDADA',
      targetAmountCents: 10000,
    },
  ];
  assert.equal(countActiveCampaigns(campaigns), 1);
  assert.deepEqual(
    filterCampaigns(campaigns, '', 'AGENDADA').map(({ name }) => name),
    ['Campanha futura'],
  );
  assert.deepEqual(filterCampaigns([], '', 'ALL'), []);
});
