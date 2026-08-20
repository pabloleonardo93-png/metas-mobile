const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  AuthSessionController,
} = require('../node_modules/.cache/calculation-tests/src/features/auth/services/authSessionController.js');
const {
  getAuthRedirect,
  getAuthenticatedArea,
} = require('../node_modules/.cache/calculation-tests/src/features/auth/utils/authRouting.js');
const {
  getLoginErrorMessage,
} = require('../node_modules/.cache/calculation-tests/src/features/auth/utils/authErrorMessage.js');

const employee = {
  email: 'employee@example.test',
  id: '00000000-0000-4000-8000-000000000001',
  joinedOn: '2026-08-01',
  name: 'Funcionário Teste',
  role: 'BALCONISTA',
  status: 'ATIVO',
};

function createHarness(overrides = {}) {
  let token = overrides.initialToken ?? null;
  const calls = {
    deleted: 0,
    googleSignOut: 0,
    loginBody: null,
    logoutToken: null,
    order: [],
    saved: [],
  };
  const storage = {
    deleteToken: async () => {
      calls.order.push('delete-local-token');
      calls.deleted += 1;
      token = null;
    },
    getToken: async () => token,
    saveToken: async (value) => {
      calls.saved.push(value);
      token = value;
    },
  };
  const api = {
    getMe: overrides.getMe ?? (async () => employee),
    loginWithGoogle:
      overrides.loginWithGoogle ??
      (async (body) => {
        calls.loginBody = body;
        return {
          expiresAt: '2026-08-19T12:00:00.000Z',
          sessionToken: 'opaque-session-token',
          user: { id: employee.id, name: employee.name, role: employee.role },
        };
      }),
    logout: async (sessionToken) => {
      calls.order.push('revoke-api-session');
      calls.logoutToken = sessionToken;
      if (overrides.logout) {
        return overrides.logout(sessionToken);
      }
      if (overrides.logoutError) {
        throw overrides.logoutError;
      }
    },
  };
  const google = {
    signIn: overrides.signIn ?? (async () => ({ idToken: 'google-id-token', type: 'success' })),
    signOut: async () => {
      calls.order.push('google-sign-out');
      calls.googleSignOut += 1;
      if (overrides.googleSignOutError) {
        throw overrides.googleSignOutError;
      }
    },
  };

  return {
    calls,
    controller: new AuthSessionController(api, storage, google),
    getToken: () => token,
  };
}

test('Google login sends only the ID token, stores the session, and resolves /me', async () => {
  const harness = createHarness();
  const result = await harness.controller.loginWithGoogle();

  assert.deepEqual(harness.calls.loginBody, { idToken: 'google-id-token' });
  assert.deepEqual(harness.calls.saved, ['opaque-session-token']);
  assert.equal(harness.getToken(), 'opaque-session-token');
  assert.deepEqual(result, employee);
});

test('cancelled Google login does not call the API or persist a session', async () => {
  const harness = createHarness({ signIn: async () => ({ type: 'cancelled' }) });

  assert.equal(await harness.controller.loginWithGoogle(), null);
  assert.equal(harness.calls.loginBody, null);
  assert.deepEqual(harness.calls.saved, []);
});

test('a denied login leaves no session and a new attempt can succeed', async () => {
  let attempts = 0;
  const denied = Object.assign(new Error('denied'), {
    code: 'ACCESS_NOT_AUTHORIZED',
    status: 403,
  });
  const harness = createHarness({
    loginWithGoogle: async () => {
      attempts += 1;
      if (attempts === 1) {
        throw denied;
      }
      return {
        expiresAt: '2026-08-19T12:00:00.000Z',
        sessionToken: 'opaque-session-token',
        user: { id: employee.id, name: employee.name, role: employee.role },
      };
    },
  });

  await assert.rejects(() => harness.controller.loginWithGoogle(), denied);
  assert.equal(harness.getToken(), null);
  assert.deepEqual(harness.calls.saved, []);

  assert.deepEqual(await harness.controller.loginWithGoogle(), employee);
  assert.equal(attempts, 2);
  assert.equal(harness.getToken(), 'opaque-session-token');
});

test('a stored session is restored through /me', async () => {
  const harness = createHarness({ initialToken: 'stored-token' });

  assert.deepEqual(await harness.controller.restoreSession(), employee);
  assert.equal(harness.getToken(), 'stored-token');
});

test('/me 401 removes an invalid stored session', async () => {
  const unauthorized = Object.assign(new Error('unauthorized'), { status: 401 });
  const harness = createHarness({
    getMe: async () => {
      throw unauthorized;
    },
    initialToken: 'expired-token',
  });

  assert.equal(await harness.controller.restoreSession(), null);
  assert.equal(harness.getToken(), null);
  assert.equal(harness.calls.deleted, 1);
});

test('a temporary network error preserves the stored session', async () => {
  const networkError = Object.assign(new Error('network'), { status: null });
  const harness = createHarness({
    getMe: async () => {
      throw networkError;
    },
    initialToken: 'valid-token',
  });

  await assert.rejects(() => harness.controller.restoreSession(), networkError);
  assert.equal(harness.getToken(), 'valid-token');
  assert.equal(harness.calls.deleted, 0);
});

test('logout always removes the local session when the API is unavailable', async () => {
  const harness = createHarness({
    initialToken: 'valid-token',
    logoutError: new Error('network'),
  });

  await assert.rejects(() => harness.controller.logout());
  assert.equal(harness.calls.logoutToken, 'valid-token');
  assert.equal(harness.calls.googleSignOut, 1);
  assert.equal(harness.getToken(), null);
});

test('Google sign-out failure does not prevent application logout', async () => {
  const harness = createHarness({
    googleSignOutError: new Error('google unavailable'),
    initialToken: 'valid-token',
  });

  await harness.controller.logout();

  assert.equal(harness.calls.logoutToken, 'valid-token');
  assert.equal(harness.calls.googleSignOut, 1);
  assert.equal(harness.getToken(), null);
});

test('logout removes the local token before waiting for network revocation', async () => {
  let releaseLogout;
  const harness = createHarness({
    initialToken: 'valid-token',
    logout: () =>
      new Promise((resolve) => {
        releaseLogout = resolve;
      }),
  });

  const logoutPromise = harness.controller.logout();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(harness.getToken(), null);
  assert.deepEqual(harness.calls.order, ['delete-local-token', 'revoke-api-session']);

  releaseLogout();
  await logoutPromise;
  assert.deepEqual(harness.calls.order, [
    'delete-local-token',
    'revoke-api-session',
    'google-sign-out',
  ]);
});

test('routes manager and all employee roles to their correct shared area', () => {
  assert.equal(getAuthenticatedArea('GESTOR'), 'manager');
  assert.equal(getAuthenticatedArea('BALCONISTA'), 'employee');
  assert.equal(getAuthenticatedArea('CAIXA'), 'employee');
  assert.equal(getAuthenticatedArea('FARMACEUTICO'), 'employee');
});

test('redirects both authenticated areas to login synchronously after logout', () => {
  assert.equal(getAuthRedirect('unauthenticated', null, '(gestor)'), 'login');
  assert.equal(getAuthRedirect('unauthenticated', null, '(funcionario)'), 'login');
  assert.equal(getAuthRedirect('unauthenticated', null, '(auth)'), null);
});

test('prevents protected routes from reopening for an unauthenticated user', () => {
  assert.equal(getAuthRedirect('unauthenticated', null, '(gestor)'), 'login');
  assert.equal(getAuthRedirect('unauthenticated', null, '(funcionario)'), 'login');
  assert.equal(getAuthRedirect('authenticated', 'GESTOR', '(auth)'), 'manager-home');
  assert.equal(getAuthRedirect('authenticated', 'CAIXA', '(auth)'), 'employee-home');
});

test('maps authorization, rate limit, and network errors without exposing internals', () => {
  assert.equal(
    getLoginErrorMessage({ code: 'ACCESS_NOT_AUTHORIZED', status: 403 }),
    'Não foi possível autorizar o acesso desta conta.',
  );
  assert.match(getLoginErrorMessage({ status: 429 }), /Muitas tentativas/u);
  assert.match(getLoginErrorMessage({ code: 'NETWORK_ERROR', status: null }), /conectar/u);
});
