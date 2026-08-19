const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  EmployeeApiClient,
  EmployeeSessionUnavailableError,
} = require('../node_modules/.cache/calculation-tests/src/features/employees/services/employeeApiClient.js');
const {
  employeesReducer,
  initialEmployeesState,
} = require('../node_modules/.cache/calculation-tests/src/features/employees/state/employeesState.js');
const {
  getEmployeeApiErrorMessage,
} = require('../node_modules/.cache/calculation-tests/src/features/employees/utils/employeeApiError.js');

const responseEmployee = {
  email: 'ana@example.test',
  id: '00000000-0000-4000-8000-000000000010',
  joinedOn: '2026-08-13',
  name: 'Ana Souza',
  role: 'BALCONISTA',
  status: 'ATIVO',
};

function createHarness(overrides = {}) {
  const calls = [];
  const storage = {
    getToken: async () => (overrides.withoutToken ? null : 'session-token'),
  };
  const request = async (path, options = {}) => {
    calls.push({ options, path });
    if (overrides.error) throw overrides.error;
    if (path === '/v1/manager/employees' && options.method !== 'POST') {
      return overrides.list ?? [responseEmployee];
    }
    return { ...responseEmployee, ...(overrides.response ?? {}) };
  };
  return { calls, client: new EmployeeApiClient(request, storage) };
}

test('employee state represents loading, empty success, errors, and updates', () => {
  assert.equal(initialEmployeesState.status, 'loading');
  const empty = employeesReducer(initialEmployeesState, {
    employees: [],
    type: 'loadSucceeded',
  });
  assert.equal(empty.status, 'ready');
  assert.deepEqual(empty.employees, []);

  const failed = employeesReducer(empty, {
    errorMessage: 'network',
    type: 'loadFailed',
  });
  assert.equal(failed.status, 'error');
  assert.equal(failed.errorMessage, 'network');

  const started = employeesReducer(failed, { type: 'loadStarted' });
  assert.equal(started.status, 'loading');
  assert.equal(started.errorMessage, null);
});

test('list uses the stored session and maps joinedOn to joinedAt', async () => {
  const harness = createHarness();
  const employees = await harness.client.list();
  assert.equal(employees[0].joinedAt, responseEmployee.joinedOn);
  assert.equal(harness.calls[0].options.sessionToken, 'session-token');
  assert.equal(harness.calls[0].path, '/v1/manager/employees');
});

test('create, edit, and status use authenticated API mutations', async () => {
  const harness = createHarness();
  const input = {
    email: 'ana@example.test',
    joinedAt: '2026-08-13',
    name: 'Ana Souza',
    role: 'BALCONISTA',
    status: 'ATIVO',
  };
  const created = await harness.client.create(input);
  await harness.client.update(created.id, { ...input, name: 'Ana Lima' });
  await harness.client.setStatus(created.id, 'INATIVO');

  assert.equal(harness.calls[0].options.method, 'POST');
  assert.deepEqual(harness.calls[0].options.body, {
    email: input.email,
    joinedOn: input.joinedAt,
    name: input.name,
    role: input.role,
    status: input.status,
  });
  assert.equal(harness.calls[1].options.method, 'PATCH');
  assert.match(harness.calls[1].path, new RegExp(`${created.id}$`));
  assert.equal(harness.calls[2].options.method, 'PATCH');
  assert.match(harness.calls[2].path, /\/status$/);
});

test('missing local session prevents unauthenticated employee requests', async () => {
  const harness = createHarness({ withoutToken: true });
  await assert.rejects(() => harness.client.list(), EmployeeSessionUnavailableError);
  assert.equal(harness.calls.length, 0);
});

test('network, 401, and 403 failures remain controlled for the UI', async () => {
  for (const error of [
    { code: 'NETWORK_ERROR', status: null },
    { code: 'UNAUTHORIZED', status: 401 },
    { code: 'FORBIDDEN', status: 403 },
  ]) {
    const harness = createHarness({ error });
    await assert.rejects(
      () => harness.client.list(),
      (received) => received === error,
    );
  }

  assert.match(getEmployeeApiErrorMessage({ status: null }), /conectar/u);
  assert.match(getEmployeeApiErrorMessage({ status: 401 }), /sessão/u);
  assert.match(getEmployeeApiErrorMessage({ status: 403 }), /permissão/u);
});

test('upsert makes created and edited employees visible without reloading', () => {
  const employee = {
    ...responseEmployee,
    joinedAt: responseEmployee.joinedOn,
  };
  delete employee.joinedOn;
  const created = employeesReducer(initialEmployeesState, {
    employee,
    type: 'upserted',
  });
  assert.equal(created.employees.length, 1);

  const updated = employeesReducer(created, {
    employee: { ...employee, name: 'Ana Lima', status: 'INATIVO' },
    type: 'upserted',
  });
  assert.equal(updated.employees.length, 1);
  assert.equal(updated.employees[0].name, 'Ana Lima');
  assert.equal(updated.employees[0].status, 'INATIVO');
});
