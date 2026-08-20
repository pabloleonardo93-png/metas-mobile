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
  calculateMonthDayCounts,
  calculatePeriodDayCounts,
} = require('../node_modules/.cache/calculation-tests/src/shared/utils/datePeriods.js');
const {
  formatCampaignDaySummary,
} = require('../node_modules/.cache/calculation-tests/src/features/campaigns/utils/campaignDates.js');

function localDate(year, month, day) {
  return {
    getDate: () => day,
    getFullYear: () => year,
    getMonth: () => month - 1,
  };
}

test('calcula corretamente a quantidade de dias de cada tipo de mês', () => {
  assert.deepEqual(calculateMonthDayCounts('2026-01', localDate(2026, 1, 1)), {
    remainingDays: 31,
    totalDays: 31,
  });
  assert.equal(calculateMonthDayCounts('2026-04', localDate(2026, 4, 1)).totalDays, 30);
  assert.equal(calculateMonthDayCounts('2025-02', localDate(2025, 2, 1)).totalDays, 28);
  assert.equal(calculateMonthDayCounts('2024-02', localDate(2024, 2, 1)).totalDays, 29);
  assert.equal(calculateMonthDayCounts('2026-12', localDate(2026, 12, 1)).totalDays, 31);
});

test('calcula dias restantes do mês de forma inclusiva', () => {
  assert.equal(calculateMonthDayCounts('2026-08', localDate(2026, 8, 1)).remainingDays, 31);
  assert.equal(calculateMonthDayCounts('2026-08', localDate(2026, 8, 20)).remainingDays, 12);
  assert.equal(calculateMonthDayCounts('2026-08', localDate(2026, 8, 31)).remainingDays, 1);
});

test('mês futuro tem todo o período restante e mês passado tem zero', () => {
  assert.deepEqual(calculateMonthDayCounts('2026-09', localDate(2026, 8, 20)), {
    remainingDays: 30,
    totalDays: 30,
  });
  assert.deepEqual(calculateMonthDayCounts('2026-07', localDate(2026, 8, 20)), {
    remainingDays: 0,
    totalDays: 31,
  });
});

test('campanha de um único dia conta início e fim', () => {
  assert.deepEqual(
    calculatePeriodDayCounts('2026-08-20', '2026-08-20', localDate(2026, 8, 20)),
    { remainingDays: 1, totalDays: 1 },
  );
  assert.equal(
    formatCampaignDaySummary('2026-08-20', '2026-08-20', localDate(2026, 8, 20)),
    '1 dia no período · 1 dia restante',
  );
});

test('campanha futura, iniciada, em andamento, no fim e encerrada usa contagem inclusiva', () => {
  const start = '2026-08-10';
  const end = '2026-08-25';

  assert.deepEqual(calculatePeriodDayCounts(start, end, localDate(2026, 8, 5)), {
    remainingDays: 16,
    totalDays: 16,
  });
  assert.equal(calculatePeriodDayCounts(start, end, localDate(2026, 8, 10)).remainingDays, 16);
  assert.equal(calculatePeriodDayCounts(start, end, localDate(2026, 8, 20)).remainingDays, 6);
  assert.equal(calculatePeriodDayCounts(start, end, localDate(2026, 8, 25)).remainingDays, 1);
  assert.equal(calculatePeriodDayCounts(start, end, localDate(2026, 8, 26)).remainingDays, 0);
});

test('sábado e domingo são contabilizados normalmente', () => {
  assert.deepEqual(
    calculatePeriodDayCounts('2026-08-21', '2026-08-24', localDate(2026, 8, 21)),
    { remainingDays: 4, totalDays: 4 },
  );
});

test('conta corretamente períodos na virada do mês e do ano', () => {
  assert.deepEqual(
    calculatePeriodDayCounts('2026-08-30', '2026-09-02', localDate(2026, 8, 30)),
    { remainingDays: 4, totalDays: 4 },
  );
  assert.deepEqual(
    calculatePeriodDayCounts('2026-12-30', '2027-01-02', localDate(2026, 12, 30)),
    { remainingDays: 4, totalDays: 4 },
  );
});

test('usa a data civil local sem deslocamento UTC', () => {
  const localNight = localDate(2026, 8, 19);

  assert.equal(calculateMonthDayCounts('2026-08', localNight).remainingDays, 13);
  assert.equal(
    calculatePeriodDayCounts('2026-08-19', '2026-08-20', localNight).remainingDays,
    2,
  );
});

test('runtime usa campos automáticos e não exibe terminologia de dias úteis', () => {
  const files = [
    'src/features/metas/components/GeneralGoalSettingsForm.tsx',
    'src/features/campaigns/components/CampaignForm.tsx',
    'src/features/metas/components/GoalQuickSummary.tsx',
    'src/features/dashboard/components/ManagerQuickSummary.tsx',
  ];
  const source = files.map((file) => fs.readFileSync(path.resolve(file), 'utf8')).join('\n');

  assert.match(source, /AutomaticDaysFields/u);
  assert.doesNotMatch(source, /dias úteis|Dias Úteis/iu);
  assert.doesNotMatch(source, /onRemainingChange|onTotalChange/u);
});
