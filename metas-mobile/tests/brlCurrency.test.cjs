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
  formatCentsAsBrl,
  formatCentsForBrlInput,
  parseBrlCurrencyToCents,
  sanitizeBrlCurrencyInput,
} = require(path.join(buildRoot, 'src/shared/utils/brlCurrency.js'));
const { validateCampaignForm } = require(
  path.join(buildRoot, 'src/features/campaigns/utils/validateCampaignForm.js'),
);

test('interpreta todos os digitos como centavos inteiros exatos', () => {
  assert.equal(parseBrlCurrencyToCents('2'), 2);
  assert.equal(parseBrlCurrencyToCents('50050500'), 50050500);
  assert.equal(parseBrlCurrencyToCents('500.505,56'), 50050556);
  assert.equal(parseBrlCurrencyToCents('2.505.065,56'), 250506556);
});

test('formata centavos como BRL com duas casas decimais', () => {
  assert.equal(formatCentsForBrlInput(50000050), '500.000,50');
  assert.equal(formatCentsAsBrl(125099), 'R$ 1.250,99');
});

test('aplica mascara automatica de centavos durante a digitacao', () => {
  const examples = [
    ['2', '0,02'],
    ['22', '0,22'],
    ['223', '2,23'],
    ['22300', '223,00'],
    ['223456', '2.234,56'],
    ['50050500', '500.505,00'],
    ['250506556', '2.505.065,56'],
  ];

  for (const [input, expected] of examples) {
    assert.equal(sanitizeBrlCurrencyInput(input), expected);
  }
});

test('backspace desloca os centavos no sentido inverso', () => {
  const expectedValues = ['223,45', '22,34', '2,23', '0,22', '0,02', '0,00'];
  let currentValue = '2.234,56';

  for (const expectedValue of expectedValues) {
    currentValue = sanitizeBrlCurrencyInput(currentValue.slice(0, -1));
    assert.equal(currentValue, expectedValue);
  }
});

test('aceita colagem brasileira e sanitiza caracteres extras', () => {
  assert.equal(sanitizeBrlCurrencyInput('500.505,56'), '500.505,56');
  assert.equal(sanitizeBrlCurrencyInput('abc 250506556 xyz'), '2.505.065,56');
  assert.equal(sanitizeBrlCurrencyInput('0'), '0,00');
  assert.equal(sanitizeBrlCurrencyInput(''), '0,00');
  assert.equal(parseBrlCurrencyToCents(''), null);
});

test('rejeita negativos e valores acima do limite seguro', () => {
  assert.equal(sanitizeBrlCurrencyInput('-10,00'), '');
  assert.equal(parseBrlCurrencyToCents('-10,00'), null);
  assert.equal(parseBrlCurrencyToCents('999999999999999,99'), null);
});

test('valida separadamente quantidade e valor financeiro da campanha', () => {
  const validValues = {
    endDate: '31/08/2026',
    name: 'Produto em foco',
    startDate: '01/08/2026',
    targetAmount: '5.000,50',
    targetQuantity: '50',
  };

  assert.deepEqual(validateCampaignForm(validValues), {});
  assert.equal(
    validateCampaignForm({ ...validValues, targetAmount: '' }).targetAmount,
    'Informe o valor financeiro da meta.',
  );
  assert.equal(
    validateCampaignForm({ ...validValues, targetAmount: '0,00' }).targetAmount,
    'O valor da meta deve ser maior que zero.',
  );
});
