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
const {
  createEmployeeMutationRunner,
} = require('../node_modules/.cache/calculation-tests/src/features/employees/utils/employeeMutationFeedback.js');
const {
  countActiveEmployees,
  summarizeTeamByRole,
} = require('../node_modules/.cache/calculation-tests/src/features/employees/utils/employee.utils.js');
const {
  normalizeEmployeeEmail,
  validateEmployeeEmail,
} = require('../node_modules/.cache/calculation-tests/src/features/employees/utils/validateEmployeeForm.js');
const {
  buildManagerTeamPerformance,
  calculateManagerDashboardMetrics,
} = require('../node_modules/.cache/calculation-tests/src/features/dashboard/utils/calculateManagerDashboard.js');

const responseEmployee = {
  email: 'ana@example.test',
  googleLinked: false,
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

test('employee email normalization trims and lowercases without locale-specific rules', () => {
  assert.equal(normalizeEmployeeEmail('  PedraMarcos78@GMAIL.COM  '), 'pedramarcos78@gmail.com');
  assert.equal(validateEmployeeEmail('  NOVO@GMAIL.COM  '), undefined);
  assert.match(validateEmployeeEmail('invalido'), /válido/u);
});

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

test('explicit access email change uses its dedicated authenticated endpoint', async () => {
  const harness = createHarness({
    response: { email: 'novo@example.test', googleLinked: false },
  });
  const employee = await harness.client.changeAccessEmail(responseEmployee.id, {
    email: 'novo@example.test',
  });

  assert.equal(employee.email, 'novo@example.test');
  assert.equal(employee.googleLinked, false);
  assert.equal(harness.calls[0].options.method, 'PATCH');
  assert.deepEqual(harness.calls[0].options.body, { email: 'novo@example.test' });
  assert.match(harness.calls[0].path, /\/access-email$/u);
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

test('employee form mutation reports success, failure, loading, and blocks duplicate submits', async () => {
  const runner = createEmployeeMutationRunner();
  const lifecycle = [];
  let releaseMutation;
  let mutationCalls = 0;
  const mutation = new Promise((resolve) => {
    releaseMutation = resolve;
  });
  const messages = {
    error: 'Não foi possível salvar as alterações. Tente novamente.',
    success: 'Funcionário atualizado com sucesso.',
  };

  const first = runner.run(
    async () => {
      mutationCalls += 1;
      await mutation;
      return 'updated';
    },
    messages,
    {
      onFinished: () => lifecycle.push('finished'),
      onStarted: () => lifecycle.push('started'),
    },
  );
  const duplicate = await runner.run(async () => 'duplicate', messages);

  assert.equal(runner.isRunning(), true);
  assert.equal(duplicate, null);
  assert.equal(mutationCalls, 1);
  assert.deepEqual(lifecycle, ['started']);

  releaseMutation();
  assert.deepEqual(await first, {
    feedback: { message: 'Funcionário atualizado com sucesso.', type: 'success' },
    ok: true,
    value: 'updated',
  });
  assert.equal(runner.isRunning(), false);
  assert.deepEqual(lifecycle, ['started', 'finished']);

  assert.deepEqual(
    await runner.run(async () => {
      throw { status: 500 };
    }, messages),
    {
      feedback: {
        message: 'Não foi possível salvar as alterações. Tente novamente.',
        type: 'error',
      },
      ok: false,
    },
  );
});

test('access email mutation feedback is independent and preserves safe API errors', async () => {
  const runner = createEmployeeMutationRunner();
  const messages = {
    error: 'Não foi possível alterar o e-mail de acesso. Tente novamente.',
    success: 'E-mail de acesso alterado com sucesso.',
  };

  const success = await runner.run(async () => ({ email: 'novo@example.test' }), messages);
  assert.equal(success.feedback.message, 'E-mail de acesso alterado com sucesso.');

  const conflict = await runner.run(async () => {
    throw { code: 'EMPLOYEE_ALREADY_EXISTS', status: 409 };
  }, messages);
  assert.equal(conflict.feedback.message, 'Já existe um cadastro com este e-mail.');
  assert.equal(conflict.feedback.type, 'error');
});

test('employee edit feedback stays local until a field is edited again', () => {
  const formSource = fs.readFileSync(
    path.resolve('src/features/employees/components/EmployeeForm.tsx'),
    'utf8',
  );
  const screenSource = fs.readFileSync(
    path.resolve('src/features/employees/screens/EmployeeFormScreen.tsx'),
    'utf8',
  );

  assert.match(formSource, /setSubmitFeedback\(null\);/u);
  assert.match(screenSource, /Funcionário atualizado com sucesso\./u);
  assert.match(formSource, /E-mail de acesso alterado com sucesso\./u);
  assert.doesNotMatch(
    screenSource,
    /router\.replace\(appRoutes\.managerEmployeeDetails\(updatedEmployee/u,
  );
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

test('manager dashboard follows shared employee role and status mutations', () => {
  const manager = {
    email: 'manager@example.test',
    googleLinked: true,
    id: '00000000-0000-4000-8000-000000000001',
    joinedAt: '2026-08-01',
    name: 'Manager One',
    role: 'GESTOR',
    status: 'ATIVO',
  };
  const attendant = {
    ...responseEmployee,
    joinedAt: responseEmployee.joinedOn,
  };
  delete attendant.joinedOn;

  const loaded = employeesReducer(initialEmployeesState, {
    employees: [manager, attendant],
    type: 'loadSucceeded',
  });
  assert.equal(countActiveEmployees(loaded.employees), 2);
  assert.deepEqual(summarizeTeamByRole(loaded.employees), {
    BALCONISTA: 1,
    CAIXA: 0,
    FARMACEUTICO: 0,
    GESTOR: 1,
  });

  const promoted = employeesReducer(loaded, {
    employee: { ...attendant, role: 'GESTOR' },
    type: 'upserted',
  });
  const promotedSummary = summarizeTeamByRole(promoted.employees);
  assert.equal(countActiveEmployees(promoted.employees), 2);
  assert.equal(promotedSummary.GESTOR, 2);
  assert.equal(promotedSummary.BALCONISTA, 0);
  assert.deepEqual(buildManagerTeamPerformance(promotedSummary), []);

  const inactive = employeesReducer(promoted, {
    employee: { ...attendant, role: 'GESTOR', status: 'INATIVO' },
    type: 'upserted',
  });
  assert.equal(countActiveEmployees(inactive.employees), 1);
  assert.equal(summarizeTeamByRole(inactive.employees).GESTOR, 1);
  assert.equal(
    calculateManagerDashboardMetrics(
      {
        monthlyTarget: 500000,
        remainingBusinessDays: 13,
        soldAmount: 250000.65,
        totalBusinessDays: 31,
      },
      countActiveEmployees(inactive.employees),
      0,
    ).activeEmployees,
    1,
  );

  const reactivatedAsAttendant = employeesReducer(inactive, {
    employee: { ...attendant, role: 'BALCONISTA', status: 'ATIVO' },
    type: 'upserted',
  });
  const reactivatedSummary = summarizeTeamByRole(reactivatedAsAttendant.employees);
  assert.equal(countActiveEmployees(reactivatedAsAttendant.employees), 2);
  assert.equal(reactivatedSummary.GESTOR, 1);
  assert.equal(reactivatedSummary.BALCONISTA, 1);
});

test('runtime source does not contain the removed demonstration catalogs', () => {
  const sourceRoot = path.resolve('src');
  const sourceFiles = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
      } else if (/\.(?:ts|tsx)$/u.test(entry.name)) {
        sourceFiles.push(entryPath);
      }
    }
  };
  visit(sourceRoot);

  assert.deepEqual(
    sourceFiles.filter((file) => file.includes(`${path.sep}mocks${path.sep}`)),
    [],
  );

  const runtimeSource = sourceFiles.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  for (const value of [
    'Ana Souza',
    'Juliana Costa',
    'Protetor Solar La Roche',
    'Vitamina C Equaliv',
    'Ômega 3 Equaliv',
    'Hidratação Neutrogena',
    'goalHistoryMock',
    'managerDashboardMock',
  ]) {
    assert.equal(runtimeSource.includes(value), false, `runtime ainda contém: ${value}`);
  }
  assert.doesNotMatch(runtimeSource, /Ã|Â|�/u);
});
