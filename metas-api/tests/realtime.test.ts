import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import { WebSocket } from 'ws';

import type {
  AuthenticatedSession,
  AuthenticationService,
  LoginResult,
  MeResult,
} from '../src/modules/auth/auth.types.js';
import { AuthenticatedRealtimeServer } from '../src/realtime/realtimeServer.js';
import { AppError } from '../src/shared/errors/AppError.js';
import type { Logger, LogContext } from '../src/shared/logging/logger.js';

const storeA = '018f47a1-3d11-7c14-a8bf-0242ac120001';
const storeB = '018f47a1-3d11-7c14-a8bf-0242ac120002';

const createSession = (storeId: string, suffix: string): AuthenticatedSession => ({
  employeeId: `018f47a1-3d11-7c14-a8bf-0242ac12${suffix}3`,
  role: 'GESTOR',
  storeId,
  tokenHash: Buffer.alloc(32, Number(suffix)),
  userId: `018f47a1-3d11-7c14-a8bf-0242ac12${suffix}4`,
});

class FakeAuthenticationService implements AuthenticationService {
  rejectRefresh = false;
  private readonly sessions = new Map([
    ['store-a-one', createSession(storeA, '01')],
    ['store-a-two', createSession(storeA, '02')],
    ['store-b-one', createSession(storeB, '03')],
  ]);

  authenticateSession(token: string): Promise<AuthenticatedSession> {
    const session = this.sessions.get(token);
    return session
      ? Promise.resolve(session)
      : Promise.reject(new AppError(401, 'UNAUTHORIZED', 'Authentication required.'));
  }
  refreshSession(session: AuthenticatedSession): Promise<AuthenticatedSession> {
    return this.rejectRefresh
      ? Promise.reject(new AppError(401, 'UNAUTHORIZED', 'Authentication required.'))
      : Promise.resolve(session);
  }
  getMe(): Promise<MeResult> {
    throw new Error('Not used');
  }
  loginWithGoogle(): Promise<LoginResult> {
    throw new Error('Not used');
  }
  logout(): Promise<void> {
    throw new Error('Not used');
  }
}

const logs: Array<{ context?: LogContext; event: string }> = [];
const logger: Logger = {
  error: (event, context) => logs.push({ event, ...(context ? { context } : {}) }),
  info: (event, context) => logs.push({ event, ...(context ? { context } : {}) }),
};

const listen = async (server: Server): Promise<number> => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return (server.address() as AddressInfo).port;
};

const waitForOpen = async (socket: WebSocket): Promise<void> => {
  await new Promise<void>((resolve) => socket.once('open', resolve));
};

const waitForSocketMessage = async (socket: WebSocket): Promise<string> =>
  await new Promise<string>((resolve) => {
    socket.once('message', (data) => {
      const buffer = Array.isArray(data)
        ? Buffer.concat(data)
        : Buffer.isBuffer(data)
          ? data
          : Buffer.from(data);
      resolve(buffer.toString('utf8'));
    });
  });

const waitForClose = async (socket: WebSocket): Promise<number> =>
  await new Promise<number>((resolve) => {
    socket.once('close', (code) => resolve(code));
  });

const connect = async (url: string, token?: string): Promise<WebSocket> => {
  const socket = new WebSocket(url);
  await waitForOpen(socket);
  if (token) {
    socket.send(JSON.stringify({ token, type: 'authenticate' }));
    const message = JSON.parse(await waitForSocketMessage(socket)) as { type: string };
    assert.equal(message.type, 'authenticated');
  }
  return socket;
};

const nextMessage = async (socket: WebSocket): Promise<{ type: string }> => {
  return JSON.parse(await waitForSocketMessage(socket)) as { type: string };
};

const closeHttpServer = async (server: Server): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
};

await test('realtime authenticates valid clients without putting tokens in the URL or logs', async () => {
  logs.length = 0;
  const server = createServer();
  const realtime = new AuthenticatedRealtimeServer(server, new FakeAuthenticationService(), logger);
  const port = await listen(server);
  const url = `ws://127.0.0.1:${port}/v1/realtime`;
  const socket = await connect(url, 'store-a-one');

  assert.equal(socket.url, url);
  assert.doesNotMatch(JSON.stringify(logs), /store-a-one/u);

  socket.close();
  await realtime.close();
  await closeHttpServer(server);
});

await test('invalid, expired, and inactive sessions are refused', async () => {
  for (const token of ['invalid-token', 'expired-token', 'inactive-user-token']) {
    const server = createServer();
    const realtime = new AuthenticatedRealtimeServer(
      server,
      new FakeAuthenticationService(),
      logger,
    );
    const port = await listen(server);
    const socket = new WebSocket(`ws://127.0.0.1:${port}/v1/realtime`);
    await waitForOpen(socket);
    socket.send(JSON.stringify({ token, type: 'authenticate' }));
    const code = await waitForClose(socket);
    assert.equal(code, 4401);
    await realtime.close();
    await closeHttpServer(server);
  }
});

await test('only authenticated clients from the same store receive invalidations', async () => {
  const server = createServer();
  const realtime = new AuthenticatedRealtimeServer(server, new FakeAuthenticationService(), logger);
  const port = await listen(server);
  const url = `ws://127.0.0.1:${port}/v1/realtime`;
  const [storeAOne, storeATwo, storeBOne, unauthenticated] = await Promise.all([
    connect(url, 'store-a-one'),
    connect(url, 'store-a-two'),
    connect(url, 'store-b-one'),
    connect(url),
  ]);
  let leakedToStoreB = false;
  let leakedToUnauthenticated = false;
  storeBOne.once('message', () => {
    leakedToStoreB = true;
  });
  unauthenticated.once('message', () => {
    leakedToUnauthenticated = true;
  });
  const eventOne = nextMessage(storeAOne);
  const eventTwo = nextMessage(storeATwo);

  realtime.publish(storeA, 'employees.changed');
  assert.equal((await eventOne).type, 'employees.changed');
  assert.equal((await eventTwo).type, 'employees.changed');

  const campaignEventOne = nextMessage(storeAOne);
  const campaignEventTwo = nextMessage(storeATwo);
  realtime.publish(storeA, 'campaigns.changed');
  assert.equal((await campaignEventOne).type, 'campaigns.changed');
  assert.equal((await campaignEventTwo).type, 'campaigns.changed');
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(leakedToStoreB, false);
  assert.equal(leakedToUnauthenticated, false);

  for (const socket of [storeAOne, storeATwo, storeBOne, unauthenticated]) socket.close();
  await realtime.close();
  await closeHttpServer(server);
});

await test('unknown client messages cannot publish business events', async () => {
  const server = createServer();
  const realtime = new AuthenticatedRealtimeServer(server, new FakeAuthenticationService(), logger);
  const port = await listen(server);
  const socket = await connect(`ws://127.0.0.1:${port}/v1/realtime`, 'store-a-one');
  socket.send(JSON.stringify({ type: 'employees.changed' }));
  const code = await waitForClose(socket);
  assert.equal(code, 1008);
  await realtime.close();
  await closeHttpServer(server);
});

await test('heartbeat closes a session that was revoked or expired after connection', async () => {
  const server = createServer();
  const authenticationService = new FakeAuthenticationService();
  const realtime = new AuthenticatedRealtimeServer(server, authenticationService, logger, {
    heartbeatIntervalMs: 10,
  });
  const port = await listen(server);
  const socket = await connect(`ws://127.0.0.1:${port}/v1/realtime`, 'store-a-one');
  authenticationService.rejectRefresh = true;
  const code = await waitForClose(socket);
  assert.equal(code, 4401);
  await realtime.close();
  await closeHttpServer(server);
});
