const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const {
  createToastController,
  TOAST_DURATION_MS,
} = require('../node_modules/.cache/calculation-tests/src/shared/toast/toastController.js');

function createFakeTimer() {
  const cleared = [];
  const tasks = new Map();
  let nextId = 1;

  return {
    cleared,
    run(id) {
      const task = tasks.get(id);
      tasks.delete(id);
      task?.callback();
    },
    tasks,
    timer: {
      clear(id) {
        cleared.push(id);
        tasks.delete(id);
      },
      schedule(callback, durationMs) {
        const id = nextId;
        nextId += 1;
        tasks.set(id, { callback, durationMs });
        return id;
      },
    },
  };
}

test('toast uses three seconds for success and five seconds for errors', () => {
  const fake = createFakeTimer();
  const controller = createToastController(fake.timer);

  controller.show({ message: 'Salvo', type: 'success' });
  assert.equal([...fake.tasks.values()][0].durationMs, TOAST_DURATION_MS.success);

  controller.show({ message: 'Falhou', type: 'error' });
  assert.equal([...fake.tasks.values()][0].durationMs, TOAST_DURATION_MS.error);
});

test('a new toast replaces the current one and cancels its timer', () => {
  const fake = createFakeTimer();
  const controller = createToastController(fake.timer);

  controller.show({ message: 'Primeiro', type: 'info' });
  const firstTimer = [...fake.tasks.keys()][0];
  controller.show({ message: 'Segundo', type: 'success' });

  assert.deepEqual(fake.cleared, [firstTimer]);
  assert.equal(fake.tasks.size, 1);
  assert.equal(controller.getCurrent().message, 'Segundo');
});

test('toast disappears when its active timer expires', () => {
  const fake = createFakeTimer();
  const controller = createToastController(fake.timer);
  const notifications = [];
  controller.subscribe((toast) => notifications.push(toast?.message ?? null));

  controller.show({ message: 'Temporário', type: 'success' });
  fake.run([...fake.tasks.keys()][0]);

  assert.equal(controller.getCurrent(), null);
  assert.deepEqual(notifications, ['Temporário', null]);
});

test('disposing the provider controller clears timers and listeners', () => {
  const fake = createFakeTimer();
  const controller = createToastController(fake.timer);
  let notifications = 0;
  controller.subscribe(() => {
    notifications += 1;
  });
  controller.show({ message: 'Ativo', type: 'error' });
  const activeTimer = [...fake.tasks.keys()][0];

  controller.dispose();
  controller.show({ message: 'Novo', type: 'info' });

  assert.ok(fake.cleared.includes(activeTimer));
  assert.equal(notifications, 1);
});

test('global host survives routes and inline login feedback is removed', () => {
  const providersSource = fs.readFileSync(path.resolve('src/providers/AppProviders.tsx'), 'utf8');
  const hostSource = fs.readFileSync(path.resolve('src/shared/toast/ToastProvider.tsx'), 'utf8');
  const loginSource = fs.readFileSync(
    path.resolve('src/features/auth/components/LoginForm.tsx'),
    'utf8',
  );
  const authProviderSource = fs.readFileSync(
    path.resolve('src/features/auth/context/AuthProvider.tsx'),
    'utf8',
  );

  assert.match(providersSource, /<ToastProvider>[\s\S]*<AuthProvider>/u);
  assert.match(hostSource, /position: 'absolute'/u);
  assert.match(hostSource, /useSafeAreaInsets\(\)/u);
  assert.match(hostSource, /zIndex: 1_000/u);
  assert.match(authProviderSource, /showToast\(\{ message: getLoginErrorMessage\(error\)/u);
  assert.doesNotMatch(loginSource, /errorMessage/u);
  assert.doesNotMatch(loginSource, /accessibilityLiveRegion/u);
});

test('goal, campaign, and profile action results use the existing global toast', () => {
  const goalFormSource = fs.readFileSync(
    path.resolve('src/features/metas/components/GeneralGoalSettingsForm.tsx'),
    'utf8',
  );
  const campaignFormSource = fs.readFileSync(
    path.resolve('src/features/campaigns/screens/CampaignFormScreen.tsx'),
    'utf8',
  );
  const campaignDetailsSource = fs.readFileSync(
    path.resolve('src/features/campaigns/screens/CampaignDetailsScreen.tsx'),
    'utf8',
  );
  const profileSource = fs.readFileSync(
    path.resolve('src/features/profile/screens/ProfileScreen.tsx'),
    'utf8',
  );

  assert.match(goalFormSource, /showToast\([\s\S]*saveGoalConfigurationWithFeedback/u);
  assert.doesNotMatch(goalFormSource, /styles\.confirmation/u);
  assert.match(campaignFormSource, /Campanha criada com sucesso\./u);
  assert.match(campaignFormSource, /Campanha atualizada com sucesso\./u);
  assert.doesNotMatch(campaignFormSource, /Alert\.alert/u);
  assert.match(campaignDetailsSource, /Campanha encerrada com sucesso\./u);
  assert.match(profileSource, /type: 'info'/u);
  assert.doesNotMatch(profileSource, /Alert\.alert\(title/u);
});

test('field errors, load states, and destructive confirmations remain in their proper UI', () => {
  const authGateSource = fs.readFileSync(
    path.resolve('src/features/auth/components/AuthGate.tsx'),
    'utf8',
  );
  const campaignDetailsSource = fs.readFileSync(
    path.resolve('src/features/campaigns/screens/CampaignDetailsScreen.tsx'),
    'utf8',
  );
  const employeeFormSource = fs.readFileSync(
    path.resolve('src/features/employees/components/EmployeeForm.tsx'),
    'utf8',
  );
  const employeeScreenSource = fs.readFileSync(
    path.resolve('src/features/employees/screens/EmployeeFormScreen.tsx'),
    'utf8',
  );
  const profileSource = fs.readFileSync(
    path.resolve('src/features/profile/screens/ProfileScreen.tsx'),
    'utf8',
  );
  const weightHelpSource = fs.readFileSync(
    path.resolve('src/features/metas/components/TeamDistributionSection.tsx'),
    'utf8',
  );

  assert.match(authGateSource, /retryRestore/u);
  assert.match(employeeFormSource, /error=\{submitted \? errors\.email/u);
  assert.match(employeeScreenSource, /Alert\.alert\([\s\S]*Alterar e-mail de acesso/u);
  assert.match(campaignDetailsSource, /Alert\.alert\([\s\S]*Encerrar campanha/u);
  assert.match(profileSource, /Alert\.alert\([\s\S]*Deseja sair\?/u);
  assert.match(weightHelpSource, /Como funcionam os pesos/u);
});
