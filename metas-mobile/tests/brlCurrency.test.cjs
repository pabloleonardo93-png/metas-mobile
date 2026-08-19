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

test('converte entradas brasileiras para centavos inteiros', () => {
  assert.equal(parseBrlCurrencyToCents('500000'), 50000000);
  assert.equal(parseBrlCurrencyToCents('500000,50'), 50000050);
  assert.equal(parseBrlCurrencyToCents('1.250,99'), 125099);
  assert.equal(parseBrlCurrencyToCents('1250.99'), 125099);
});

test('formata centavos como BRL com duas casas decimais', () => {
  assert.equal(formatCentsForBrlInput(50000050), '500.000,50');
  assert.equal(formatCentsAsBrl(125099), 'R$ 1.250,99');
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
