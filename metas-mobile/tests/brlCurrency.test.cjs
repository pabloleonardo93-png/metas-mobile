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
  isEditableBrlCurrencyInput,
  normalizeBrlCurrencyInput,
  parseBrlCurrencyToCents,
  sanitizeBrlCurrencyInput,
} = require(path.join(buildRoot, 'src/shared/utils/brlCurrency.js'));
const { validateCampaignForm } = require(
  path.join(buildRoot, 'src/features/campaigns/utils/validateCampaignForm.js'),
);

test('interpreta a parte inteira digitada como reais e preserva centavos exatos', () => {
  assert.equal(parseBrlCurrencyToCents('223'), 22300);
  assert.equal(parseBrlCurrencyToCents('223,50'), 22350);
  assert.equal(parseBrlCurrencyToCents('2.500,75'), 250075);
  assert.equal(parseBrlCurrencyToCents('1.250.000,99'), 125000099);
  assert.equal(parseBrlCurrencyToCents('500.505,56'), 50050556);
  assert.equal(parseBrlCurrencyToCents('2.505.065,56'), 250506556);
});

test('formata centavos como BRL com duas casas decimais', () => {
  assert.equal(formatCentsForBrlInput(50000050), '500.000,50');
  assert.equal(formatCentsAsBrl(125099), 'R$ 1.250,99');
});

test('normaliza a exibicao manual ao concluir a edicao', () => {
  assert.equal(normalizeBrlCurrencyInput('223'), '223,00');
  assert.equal(normalizeBrlCurrencyInput('223,5'), '223,50');
  assert.equal(normalizeBrlCurrencyInput('223,50'), '223,50');
  assert.equal(normalizeBrlCurrencyInput('2.500'), '2.500,00');
  assert.equal(normalizeBrlCurrencyInput('2.500,75'), '2.500,75');
});

test('aceita digitacao monetaria brasileira manual sem deslocar centavos', () => {
  const examples = [
    ['100', 10000],
    ['100,5', 10050],
    ['100,50', 10050],
    ['1.000', 100000],
    ['1.000,50', 100050],
    ['25.000.000,99', 2500000099],
  ];

  for (const [input, expectedCents] of examples) {
    assert.equal(isEditableBrlCurrencyInput(input), true);
    assert.equal(parseBrlCurrencyToCents(input), expectedCents);
  }
});

test('aceita estados intermediarios validos durante a digitacao de milhares e centavos', () => {
  for (const value of ['2', '2.', '2.5', '2.50', '2.500', '2.500,', '2.500,7', '2.500,75']) {
    assert.equal(isEditableBrlCurrencyInput(value), true, value);
  }
});

test('backspace edita o texto normalmente sem deslocamento automatico', () => {
  const expectedValues = ['2,2', '2,', '2', ''];
  let currentValue = '2,23';

  for (const expectedValue of expectedValues) {
    currentValue = currentValue.slice(0, -1);
    assert.equal(currentValue, expectedValue);
    assert.equal(isEditableBrlCurrencyInput(currentValue), true);
  }
});

test('zero pode ser apagado e digitado novamente sem tratamento especial', () => {
  assert.equal(isEditableBrlCurrencyInput('0,00'), true);
  assert.equal(isEditableBrlCurrencyInput('0,0'), true);
  assert.equal(isEditableBrlCurrencyInput('0,'), true);
  assert.equal(isEditableBrlCurrencyInput('0'), true);
  assert.equal(isEditableBrlCurrencyInput(''), true);
  assert.equal(parseBrlCurrencyToCents('223'), 22300);
});

test('aceita colagem brasileira e remove caracteres que nao pertencem ao valor', () => {
  assert.equal(sanitizeBrlCurrencyInput('R$ 500.505,56'), '500.505,56');
  assert.equal(sanitizeBrlCurrencyInput('abc 2.500,75 xyz'), '2.500,75');
  assert.equal(sanitizeBrlCurrencyInput('abc'), '');
  assert.equal(parseBrlCurrencyToCents(''), null);
});

test('rejeita pontuacao invalida, negativos e valores acima do limite seguro', () => {
  assert.equal(sanitizeBrlCurrencyInput('-10,00'), '');
  assert.equal(parseBrlCurrencyToCents('-10,00'), null);
  assert.equal(parseBrlCurrencyToCents('100,555'), null);
  assert.equal(parseBrlCurrencyToCents('100,,50'), null);
  assert.equal(parseBrlCurrencyToCents('1.000,50,20'), null);
  assert.equal(parseBrlCurrencyToCents('abc'), null);
  assert.equal(isEditableBrlCurrencyInput('100,555'), false);
  assert.equal(isEditableBrlCurrencyInput('100,,50'), false);
  assert.equal(parseBrlCurrencyToCents('999999999999999,99'), null);
});

test('formata centavos vindos da API para edicao sem perda', () => {
  assert.equal(formatCentsForBrlInput(50699392), '506.993,92');
  assert.equal(parseBrlCurrencyToCents(formatCentsForBrlInput(50699392)), 50699392);
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
