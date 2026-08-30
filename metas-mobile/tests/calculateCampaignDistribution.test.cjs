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

const { calculateCampaignDailyDistribution, createCurrentTeamDistribution } = require(
  path.join(buildRoot, 'src/features/campaigns/utils/calculateCampaignDistribution.js'),
);
const { calculateDailyGoals } = require(
  path.join(buildRoot, 'src/features/metas/utils/calculateDailyGoals.js'),
);

const configuredTeam = [
  { quantity: 0, role: 'BALCONISTA', weight: 1 },
  { quantity: 0, role: 'FARMACEUTICO', weight: 0.7 },
  { quantity: 0, role: 'CAIXA', weight: 0.3 },
];

const baseCampaign = {
  createdAt: '2026-08-01T12:00:00.000Z',
  endDate: '2026-08-20',
  id: '00000000-0000-4000-8000-000000000001',
  lockVersion: 1,
  name: 'Campanha ponderada',
  soldAmountCents: 0,
  soldQuantity: 90,
  startDate: '2026-08-01',
  status: 'ATIVA',
  targetAmountCents: 100000,
  targetQuantity: 100,
  updatedAt: '2026-08-01T12:00:00.000Z',
};

function localDate(year, month, day) {
  return {
    getDate: () => day,
    getFullYear: () => year,
    getMonth: () => month - 1,
  };
}

function employee(id, role, status = 'ATIVO') {
  return {
    email: `${id}@example.test`,
    googleLinked: false,
    id,
    joinedAt: '2026-01-01',
    name: `Funcionário ${id}`,
    role,
    status,
  };
}

const mixedTeamEmployees = [
  employee('b1', 'BALCONISTA'),
  employee('b2', 'BALCONISTA'),
  employee('b3', 'BALCONISTA'),
  employee('f1', 'FARMACEUTICO'),
  employee('f2', 'FARMACEUTICO'),
  employee('c1', 'CAIXA'),
  employee('g1', 'GESTOR'),
  employee('inactive', 'BALCONISTA', 'INATIVO'),
];

function assertClose(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} deveria ser ${expected}`);
}

test('distribui 10 unidades por dia entre balconistas, farmacêuticos e caixa', () => {
  const result = calculateCampaignDailyDistribution(
    baseCampaign,
    mixedTeamEmployees,
    configuredTeam,
    localDate(2026, 8, 20),
  );

  assert.equal(result.status, 'success');
  assert.equal(result.dailyStoreGoal, 10);
  assertClose(result.totalTeamWeight, 4.7);
  assert.deepEqual(
    result.roles.map(({ quantity, role }) => ({ quantity, role })),
    [
      { quantity: 3, role: 'BALCONISTA' },
      { quantity: 2, role: 'FARMACEUTICO' },
      { quantity: 1, role: 'CAIXA' },
    ],
  );
  assertClose(result.roles[0].dailyGoalPerEmployee, 10 / 4.7);
  assertClose(result.roles[1].dailyGoalPerEmployee, 7 / 4.7);
  assertClose(result.roles[2].dailyGoalPerEmployee, 3 / 4.7);
  assertClose(
    result.roles.reduce((sum, role) => sum + role.dailyGoalForGroup, 0),
    result.dailyStoreGoal,
  );
});

test('distribui toda a necessidade para um único cargo presente', () => {
  const result = calculateCampaignDailyDistribution(
    baseCampaign,
    [employee('f1', 'FARMACEUTICO'), employee('f2', 'FARMACEUTICO')],
    configuredTeam,
    localDate(2026, 8, 20),
  );

  assert.equal(result.status, 'success');
  assert.equal(result.roles.length, 1);
  assert.equal(result.roles[0].role, 'FARMACEUTICO');
  assert.equal(result.roles[0].dailyGoalPerEmployee, 5);
  assert.equal(result.roles[0].dailyGoalForGroup, 10);
});

test('recalcula a equipe ao adicionar, remover e mudar o cargo de funcionários', () => {
  const initial = [employee('b1', 'BALCONISTA'), employee('f1', 'FARMACEUTICO')];
  const added = [...initial, employee('c1', 'CAIXA')];
  const removed = [initial[0], { ...initial[1], status: 'INATIVO' }];
  const changedRole = [{ ...initial[0], role: 'CAIXA' }, initial[1]];
  const customWeights = configuredTeam.map((role, index) => ({ ...role, weight: index + 1 }));

  assert.deepEqual(
    createCurrentTeamDistribution(initial, configuredTeam).map(({ quantity }) => quantity),
    [1, 1, 0],
  );
  assert.deepEqual(
    createCurrentTeamDistribution(added, configuredTeam).map(({ quantity }) => quantity),
    [1, 1, 1],
  );
  assert.deepEqual(
    createCurrentTeamDistribution(removed, configuredTeam).map(({ quantity }) => quantity),
    [1, 0, 0],
  );
  assert.deepEqual(
    createCurrentTeamDistribution(changedRole, configuredTeam).map(({ quantity }) => quantity),
    [0, 1, 1],
  );
  assert.deepEqual(
    createCurrentTeamDistribution(initial, customWeights).map(({ weight }) => weight),
    [1, 2, 3],
  );
});

test('usa a quantidade parcialmente vendida para calcular a necessidade diária', () => {
  const result = calculateCampaignDailyDistribution(
    { ...baseCampaign, soldQuantity: 40 },
    [employee('b1', 'BALCONISTA')],
    configuredTeam,
    localDate(2026, 8, 15),
  );

  assert.equal(result.remainingAmount, 60);
  assert.equal(result.dailyStoreGoal, 10);
});

test('campanha concluída ou com venda acima do previsto não gera valor negativo', () => {
  for (const soldQuantity of [100, 110]) {
    const result = calculateCampaignDailyDistribution(
      { ...baseCampaign, soldQuantity },
      mixedTeamEmployees,
      configuredTeam,
      localDate(2026, 8, 20),
    );

    assert.equal(result.status, 'completed');
    assert.equal(result.remainingAmount, 0);
    assert.equal(result.dailyStoreGoal, 0);
    assert.deepEqual(result.roles, []);
  }
});

test('um único dia restante recebe toda a quantidade pendente', () => {
  const result = calculateCampaignDailyDistribution(
    { ...baseCampaign, soldQuantity: 75 },
    [employee('b1', 'BALCONISTA')],
    configuredTeam,
    localDate(2026, 8, 20),
  );

  assert.equal(result.status, 'success');
  assert.equal(result.dailyStoreGoal, 25);
  assert.equal(result.roles[0].dailyGoalPerEmployee, 25);
});

test('período encerrado não divide por zero nem produz valores inválidos', () => {
  const result = calculateCampaignDailyDistribution(
    { ...baseCampaign, status: 'ENCERRADA' },
    mixedTeamEmployees,
    configuredTeam,
    localDate(2026, 8, 21),
  );

  assert.equal(result.status, 'no-days');
  assert.equal(result.dailyStoreGoal, 0);
  assert.ok(Number.isFinite(result.remainingAmount));
  assert.match(result.message, /Campanha encerrada/u);
});

test('trata equipe vazia e peso total igual a zero', () => {
  const emptyTeam = calculateCampaignDailyDistribution(
    baseCampaign,
    [],
    configuredTeam,
    localDate(2026, 8, 20),
  );
  const zeroWeight = calculateCampaignDailyDistribution(
    baseCampaign,
    [employee('b1', 'BALCONISTA')],
    configuredTeam.map((role) => ({ ...role, weight: 0 })),
    localDate(2026, 8, 20),
  );

  assert.equal(emptyTeam.status, 'empty-team');
  assert.equal(zeroWeight.status, 'zero-weight');
  assert.equal(zeroWeight.totalTeamWeight, 0);
});

test('campanha sem controle por quantidade não calcula distribuição diária', () => {
  const result = calculateCampaignDailyDistribution(
    { ...baseCampaign, targetQuantity: null },
    mixedTeamEmployees,
    configuredTeam,
    localDate(2026, 8, 20),
  );

  assert.equal(result, null);
});

test('Metas e Campanhas usam o mesmo núcleo ponderado e produzem a mesma distribuição', () => {
  const campaign = { ...baseCampaign, soldQuantity: 40 };
  const employees = [
    employee('b1', 'BALCONISTA'),
    employee('f1', 'FARMACEUTICO'),
    employee('c1', 'CAIXA'),
  ];
  const campaignResult = calculateCampaignDailyDistribution(
    campaign,
    employees,
    configuredTeam,
    localDate(2026, 8, 15),
  );
  const currentTeam = createCurrentTeamDistribution(employees, configuredTeam);
  const goalResult = calculateDailyGoals(
    {
      monthlyTarget: 100,
      remainingBusinessDays: 6,
      soldAmount: 40,
      totalBusinessDays: 20,
    },
    currentTeam,
  );

  assert.equal(campaignResult.status, 'success');
  assert.equal(goalResult.status, 'success');
  assert.equal(campaignResult.dailyStoreGoal, goalResult.dailyStoreGoal);
  assert.equal(campaignResult.totalTeamWeight, goalResult.totalTeamWeight);
  assert.deepEqual(campaignResult.roles, goalResult.roles);
});
