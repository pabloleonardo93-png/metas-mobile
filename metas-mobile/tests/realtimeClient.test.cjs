const assert = require('node:assert/strict');
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
  RealtimeClient,
  createRealtimeUrl,
} = require('../node_modules/.cache/calculation-tests/src/realtime/realtimeClient.js');

const flush = () => new Promise((resolve) => setImmediate(resolve));

class FakeSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.onclose = null;
    this.onerror = null;
    this.onmessage = null;
    this.onopen = null;
    this.sent = [];
  }

  open() {
    this.readyState = 1;
    this.onopen?.();
  }

  receive(message) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  close(code = 1000) {
    this.readyState = 3;
    this.onclose?.({ code });
  }

  serverClose(code) {
    this.close(code);
  }

  send(data) {
    this.sent.push(data);
  }
}

function createHarness() {
  const sockets = [];
  const timers = [];
  let unauthorizedCalls = 0;
  const scheduler = {
    clearTimeout(timer) {
      const index = timers.indexOf(timer);
      if (index >= 0) timers.splice(index, 1);
    },
    setTimeout(callback, delay) {
      const timer = { callback, delay };
      timers.push(timer);
      return timer;
    },
  };
  const client = new RealtimeClient({
    apiBaseUrl: 'https://api.example.test',
    createSocket: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    onUnauthorized: () => {
      unauthorizedCalls += 1;
    },
    random: () => 0,
    scheduler,
    sessionTokenStorage: {
      deleteToken: async () => undefined,
      getToken: async () => 'session-token',
      saveToken: async () => undefined,
    },
  });
  return {
    client,
    get unauthorizedCalls() {
      return unauthorizedCalls;
    },
    runNextTimer() {
      const timer = timers.shift();
      timer?.callback();
      return timer?.delay;
    },
    sockets,
    timers,
  };
}

test('connects once, authenticates after open, and never puts the token in the URL', async () => {
  const harness = createHarness();
  let employeeSyncs = 0;
  let goalSyncs = 0;
  harness.client.subscribe('employees.changed', () => {
    employeeSyncs += 1;
  });
  harness.client.subscribe('goal.configuration.changed', () => {
    goalSyncs += 1;
  });

  harness.client.start();
  harness.client.start();
  assert.equal(harness.sockets.length, 1);
  assert.equal(harness.sockets[0].url, 'wss://api.example.test/v1/realtime');
  assert.equal(harness.sockets[0].url.includes('session-token'), false);

  harness.sockets[0].open();
  await flush();
  assert.deepEqual(JSON.parse(harness.sockets[0].sent[0]), {
    token: 'session-token',
    type: 'authenticate',
  });
  harness.sockets[0].receive({ type: 'authenticated' });
  await flush();
  assert.equal(employeeSyncs, 1);
  assert.equal(goalSyncs, 1);
});

test('coalesces duplicate invalidations while the selective refresh is running', async () => {
  const harness = createHarness();
  let releaseRefresh;
  let refreshes = 0;
  harness.client.subscribe('employees.changed', async () => {
    refreshes += 1;
    if (refreshes === 1) {
      await new Promise((resolve) => {
        releaseRefresh = resolve;
      });
    }
  });
  harness.client.start();
  harness.sockets[0].open();
  await flush();

  harness.sockets[0].receive({ type: 'employees.changed' });
  harness.sockets[0].receive({ type: 'employees.changed' });
  harness.sockets[0].receive({ type: 'employees.changed' });
  await flush();
  assert.equal(refreshes, 1);
  releaseRefresh();
  await flush();
  await flush();
  assert.equal(refreshes, 2);
});

test('reconnects with backoff, resynchronizes, and pauses while in background', async () => {
  const harness = createHarness();
  let syncs = 0;
  harness.client.subscribe('goal.configuration.changed', () => {
    syncs += 1;
  });
  harness.client.start();
  harness.sockets[0].open();
  await flush();
  harness.sockets[0].serverClose(1006);
  assert.equal(harness.timers.length, 1);
  assert.equal(harness.runNextTimer(), 1_000);
  assert.equal(harness.sockets.length, 2);

  harness.sockets[1].open();
  await flush();
  harness.sockets[1].receive({ type: 'authenticated' });
  await flush();
  assert.equal(syncs, 1);

  harness.client.setForeground(false);
  assert.equal(harness.sockets[1].readyState, 3);
  assert.equal(harness.timers.length, 0);
  harness.client.setForeground(true);
  assert.equal(harness.sockets.length, 3);
});

test('logout or user change closes the old socket and prevents stale reconnection', () => {
  const harness = createHarness();
  harness.client.start();
  const oldSocket = harness.sockets[0];
  harness.client.stop();
  assert.equal(oldSocket.readyState, 3);
  assert.equal(harness.timers.length, 0);

  harness.client.start();
  assert.equal(harness.sockets.length, 2);
  oldSocket.serverClose(1006);
  assert.equal(harness.timers.length, 0);
});

test('server authentication refusal clears the local session without reconnect loop', async () => {
  const harness = createHarness();
  harness.client.start();
  harness.sockets[0].serverClose(4401);
  await flush();
  assert.equal(harness.unauthorizedCalls, 1);
  assert.equal(harness.timers.length, 0);
});

test('realtime URL preserves only the API path and uses secure WebSocket for HTTPS', () => {
  assert.equal(
    createRealtimeUrl('https://api.example.test/base/'),
    'wss://api.example.test/base/v1/realtime',
  );
  assert.equal(createRealtimeUrl('http://localhost:3000'), 'ws://localhost:3000/v1/realtime');
});
