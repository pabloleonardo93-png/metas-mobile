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

const {
  calculateDailyGoalPerformance,
  calculateEmployeePerformanceSummary,
  getCurrentMonthSales,
  getCurrentWeekSales,
  getRecentDailyResults,
  getTodaySales,
} = require(path.join(buildRoot, 'src/features/results/utils/calculateEmployeePerformance.js'));
const { resolveCampaignContributions } = require(
  path.join(buildRoot, 'src/features/results/utils/resolveCampaignContributions.js'),
);

const referenceDate = '2026-08-11';
const dailyResults = [
  { date: '2026-08-03', soldAmount: 680 },
  { date: '2026-08-04', soldAmount: 720 },
  { date: '2026-08-05', soldAmount: 870 },
  { date: '2026-08-06', soldAmount: 980 },
  { date: '2026-08-07', soldAmount: 1100 },
  { date: '2026-08-08', soldAmount: 1250 },
  { date: '2026-08-10', soldAmount: 2310 },
  { date: '2026-08-11', soldAmount: 540 },
];

test('soma as vendas do dia de referência', () => {
  assert.equal(getTodaySales(dailyResults, referenceDate), 540);
});

test('soma as vendas da semana atual iniciada na segunda-feira', () => {
  assert.equal(getCurrentWeekSales(dailyResults, referenceDate), 2850);
});

test('soma as vendas do mês atual até a data de referência', () => {
  assert.equal(getCurrentMonthSales(dailyResults, referenceDate), 8450);
});

test('calcula meta diária ainda não atingida', () => {
  const performance = calculateDailyGoalPerformance(540, 4750);

  assert.equal(performance.status, 'PENDING');
  assert.equal(performance.remainingAmount, 4210);
  assert.equal(performance.exceededAmount, 0);
  assert.ok(performance.progress > 0 && performance.progress < 100);
});

test('identifica meta diária atingida exatamente', () => {
  const performance = calculateDailyGoalPerformance(4750, 4750);

  assert.equal(performance.status, 'ACHIEVED');
  assert.equal(performance.progress, 100);
  assert.equal(performance.remainingAmount, 0);
});

test('identifica meta diária superada e limita progresso visual', () => {
  const performance = calculateDailyGoalPerformance(5000, 4750);

  assert.equal(performance.status, 'EXCEEDED');
  assert.equal(performance.exceededAmount, 250);
  assert.equal(performance.progress, 100);
});

test('trata meta diária zero como indisponível', () => {
  const performance = calculateDailyGoalPerformance(500, 0);

  assert.equal(performance.status, 'UNAVAILABLE');
  assert.equal(performance.progress, 0);
  assert.ok(Number.isFinite(performance.remainingAmount));
});

test('retorna histórico vazio sem resultados', () => {
  assert.deepEqual(getRecentDailyResults([], referenceDate, 4750), []);
});

test('ignora datas e valores inválidos sem gerar NaN ou Infinity', () => {
  const invalidResults = [
    { date: 'data-invalida', soldAmount: 100 },
    { date: referenceDate, soldAmount: -1 },
    { date: referenceDate, soldAmount: Number.NaN },
    { date: referenceDate, soldAmount: Number.POSITIVE_INFINITY },
  ];
  const summary = calculateEmployeePerformanceSummary(invalidResults, referenceDate);

  assert.deepEqual(summary, { monthSales: 0, todaySales: 0, weekSales: 0 });
});

test('funcionário sem resultados recebe resumo zerado', () => {
  assert.deepEqual(calculateEmployeePerformanceSummary([], referenceDate), {
    monthSales: 0,
    todaySales: 0,
    weekSales: 0,
  });
});

test('resolve contribuição coletiva sem criar meta individual de campanha', () => {
  const campaign = {
    id: 'campanha-1',
    name: 'Produto em foco',
    targetAmountCents: 500000,
    targetQuantity: 50,
    soldQuantity: 32,
    startDate: '2026-08-01',
    endDate: '2026-08-31',
    status: 'ATIVA',
  };
  const resolved = resolveCampaignContributions(
    [campaign],
    [{ campaignId: campaign.id, contributedQuantity: 8 }],
  );

  assert.equal(resolved[0].campaign, campaign);
  assert.equal(resolved[0].contributedQuantity, 8);
  assert.equal('individualTarget' in resolved[0], false);
});

test('não exibe contribuição em campanha sem controle por quantidade', () => {
  const campaign = {
    id: 'campanha-sem-quantidade',
    name: 'Ação de marca',
    targetAmountCents: 500000,
    targetQuantity: null,
    soldQuantity: 0,
    startDate: '2026-08-01',
    endDate: '2026-08-31',
    status: 'ATIVA',
  };

  assert.deepEqual(
    resolveCampaignContributions([campaign], [{ campaignId: campaign.id, contributedQuantity: 8 }]),
    [],
  );
});
