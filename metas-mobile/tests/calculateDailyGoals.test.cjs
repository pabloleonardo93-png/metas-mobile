const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const Module = require('node:module');

const buildRoot = path.resolve('node_modules/.cache/calculation-tests');
const originalResolveFilename = Module._resolveFilename;

Module._resolveFilename = function resolveProjectAlias(request, parent, isMain, options) {
  const resolvedRequest = request.startsWith('@/')
    ? path.join(buildRoot, 'src', request.slice(2))
    : request;

  return originalResolveFilename.call(this, resolvedRequest, parent, isMain, options);
};

const { calculateDailyGoals, calculateTeamWeightSummary } = require(
  path.join(buildRoot, 'src/features/metas/utils/calculateDailyGoals.js'),
);
const { calculateCurrentGoalMetrics } = require(
  path.join(buildRoot, 'src/features/metas/utils/calculateCurrentGoal.js'),
);
const { getEmployeeGoalByRole } = require(
  path.join(buildRoot, 'src/features/metas/utils/getEmployeeGoalByRole.js'),
);

const settings = {
  monthlyTarget: 500000,
  remainingBusinessDays: 20,
  soldAmount: 120000,
  totalBusinessDays: 26,
};

const defaultTeam = [
  { quantity: 3, role: 'BALCONISTA', weight: 1 },
  { quantity: 1, role: 'FARMACEUTICO', weight: 0.7 },
  { quantity: 1, role: 'CAIXA', weight: 0.3 },
];

test('calcula 3 × 1,0, 1 × 0,7 e 1 × 0,3 com peso total 4,0', () => {
  const summary = calculateTeamWeightSummary(defaultTeam);

  assert.deepEqual(
    summary.roles.map(({ weightedGroupValue }) => weightedGroupValue),
    [3, 0.7, 0.3],
  );
  assert.equal(summary.totalTeamWeight, 4);
});

test('calcula o resumo da meta atual compartilhado por Dashboard e Metas', () => {
  const metrics = calculateCurrentGoalMetrics(settings);

  assert.deepEqual(metrics, {
    dailyTarget: 19000,
    progress: 24,
    remaining: 380000,
    remainingBusinessDays: 20,
    sold: 120000,
    target: 500000,
  });
});

test('limita o progresso visual em 100% quando a meta é superada', () => {
  const metrics = calculateCurrentGoalMetrics({ ...settings, soldAmount: 550000 });

  assert.equal(metrics.progress, 100);
  assert.equal(metrics.remaining, 0);
  assert.equal(metrics.dailyTarget, 0);
});

test('recalcula o peso total quando quantidade e pesos mudam', () => {
  const changedQuantity = calculateTeamWeightSummary([
    { ...defaultTeam[0], quantity: 2 },
    defaultTeam[1],
    defaultTeam[2],
  ]);
  const changedWeights = calculateTeamWeightSummary([
    { ...defaultTeam[0], weight: 0.5 },
    defaultTeam[1],
    defaultTeam[2],
  ]);

  assert.equal(changedQuantity.totalTeamWeight, 3);
  assert.equal(changedWeights.totalTeamWeight, 2.5);
});

test('distribui meta diária da loja, do cargo e por funcionário', () => {
  const result = calculateDailyGoals(settings, defaultTeam);
  const currentGoalMetrics = calculateCurrentGoalMetrics(settings);

  assert.equal(result.status, 'success');
  assert.equal(result.dailyStoreGoal, currentGoalMetrics.dailyTarget);
  assert.equal(result.totalTeamWeight, 4);
  assert.deepEqual(
    result.roles.map((role) => ({
      dailyGoalForGroup: role.dailyGoalForGroup,
      dailyGoalPerEmployee: role.dailyGoalPerEmployee,
      role: role.role,
      weightedGroupShare: role.weightedGroupShare,
    })),
    [
      {
        dailyGoalForGroup: 14250,
        dailyGoalPerEmployee: 4750,
        role: 'BALCONISTA',
        weightedGroupShare: 0.75,
      },
      {
        dailyGoalForGroup: 3325,
        dailyGoalPerEmployee: 3325,
        role: 'FARMACEUTICO',
        weightedGroupShare: 0.175,
      },
      {
        dailyGoalForGroup: 1425,
        dailyGoalPerEmployee: 1425,
        role: 'CAIXA',
        weightedGroupShare: 0.075,
      },
    ],
  );
});

test('seleciona a meta calculada do BALCONISTA pelo cargo', () => {
  const result = calculateDailyGoals(settings, defaultTeam);
  const goal = getEmployeeGoalByRole(result, 'BALCONISTA', settings.remainingBusinessDays);

  assert.deepEqual(goal, {
    dailyGoal: 4750,
    remainingBusinessDays: 20,
    remainingPeriodGoal: 95000,
    role: 'BALCONISTA',
  });
});

test('seleciona a meta calculada do FARMACEUTICO pelo cargo', () => {
  const result = calculateDailyGoals(settings, defaultTeam);
  const goal = getEmployeeGoalByRole(result, 'FARMACEUTICO', settings.remainingBusinessDays);

  assert.equal(goal?.dailyGoal, 3325);
  assert.equal(goal?.remainingPeriodGoal, 66500);
});

test('seleciona a meta calculada do CAIXA pelo cargo', () => {
  const result = calculateDailyGoals(settings, defaultTeam);
  const goal = getEmployeeGoalByRole(result, 'CAIXA', settings.remainingBusinessDays);

  assert.equal(goal?.dailyGoal, 1425);
  assert.equal(goal?.remainingPeriodGoal, 28500);
});

test('não atribui meta individual a GESTOR', () => {
  const result = calculateDailyGoals(settings, defaultTeam);

  assert.equal(getEmployeeGoalByRole(result, 'GESTOR', settings.remainingBusinessDays), null);
});

test('não seleciona cargo ausente do resultado', () => {
  const result = calculateDailyGoals(settings, [
    defaultTeam[0],
    { ...defaultTeam[1], quantity: 0 },
    defaultTeam[2],
  ]);

  assert.equal(getEmployeeGoalByRole(result, 'FARMACEUTICO', settings.remainingBusinessDays), null);
});

test('não cria meta individual para cargo com peso zero', () => {
  const result = calculateDailyGoals(settings, [
    { ...defaultTeam[0], weight: 0 },
    defaultTeam[1],
    defaultTeam[2],
  ]);

  assert.equal(getEmployeeGoalByRole(result, 'BALCONISTA', settings.remainingBusinessDays), null);
});

test('não cria meta individual quando a meta da loja foi atingida', () => {
  const result = calculateDailyGoals({ ...settings, soldAmount: 500000 }, defaultTeam);

  assert.equal(getEmployeeGoalByRole(result, 'BALCONISTA', settings.remainingBusinessDays), null);
});

test('não cria meta individual com zero dias restantes', () => {
  const result = calculateDailyGoals({ ...settings, remainingBusinessDays: 0 }, defaultTeam);

  assert.equal(getEmployeeGoalByRole(result, 'BALCONISTA', 0), null);
});

test('ignora cargo sem funcionários no resultado individual', () => {
  const result = calculateDailyGoals(settings, [
    defaultTeam[0],
    { ...defaultTeam[1], quantity: 0 },
    defaultTeam[2],
  ]);

  assert.equal(result.status, 'success');
  assert.deepEqual(
    result.roles.map(({ role }) => role),
    ['BALCONISTA', 'CAIXA'],
  );
});

test('trata equipe sem funcionários', () => {
  const result = calculateDailyGoals(
    settings,
    defaultTeam.map((role) => ({ ...role, quantity: 0 })),
  );

  assert.equal(result.status, 'empty-team');
  assert.equal(result.dailyStoreGoal, 0);
});

test('trata todos os pesos iguais a zero', () => {
  const result = calculateDailyGoals(
    settings,
    defaultTeam.map((role) => ({ ...role, weight: 0 })),
  );

  assert.equal(result.status, 'zero-weight');
  assert.equal(result.totalTeamWeight, 0);
});

test('trata meta atingida sem valores negativos', () => {
  const result = calculateDailyGoals({ ...settings, soldAmount: 550000 }, defaultTeam);

  assert.equal(result.status, 'goal-achieved');
  assert.equal(result.remainingAmount, 0);
  assert.equal(result.dailyStoreGoal, 0);
});

test('trata zero dias restantes sem divisão por zero', () => {
  const result = calculateDailyGoals({ ...settings, remainingBusinessDays: 0 }, defaultTeam);

  assert.equal(result.status, 'no-days');
  assert.equal(result.dailyStoreGoal, 0);
  assert.ok(Number.isFinite(result.remainingAmount));
});

test('rejeita valores negativos, NaN e Infinity', () => {
  const invalidSettings = [
    { ...settings, monthlyTarget: -1 },
    { ...settings, soldAmount: Number.NaN },
    { ...settings, remainingBusinessDays: Number.POSITIVE_INFINITY },
  ];

  for (const invalidSetting of invalidSettings) {
    const result = calculateDailyGoals(invalidSetting, defaultTeam);

    assert.equal(result.status, 'invalid-settings');
    assert.equal(result.dailyStoreGoal, 0);
    assert.ok(Number.isFinite(result.remainingAmount));
  }
});
