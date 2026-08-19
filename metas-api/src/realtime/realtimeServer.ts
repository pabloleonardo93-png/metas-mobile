import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';

import { WebSocket, WebSocketServer, type RawData } from 'ws';

import type { AuthenticatedSession, AuthenticationService } from '../modules/auth/auth.types.js';
import type { Logger } from '../shared/logging/logger.js';
import type { RealtimeEventType, RealtimePublisher } from './realtime.types.js';

const AUTHENTICATION_TIMEOUT_MS = 5_000;
const HEARTBEAT_INTERVAL_MS = 30_000;
const MAX_MESSAGE_BYTES = 4_096;
const REALTIME_PATH = '/v1/realtime';

interface ClientState {
  authenticationPending: boolean;
  authenticationTimer: NodeJS.Timeout;
  connectionId: string;
  isAlive: boolean;
  session: AuthenticatedSession | null;
  validationPending: boolean;
}

interface AuthenticationMessage {
  token: string;
  type: 'authenticate';
}

interface RealtimeServerOptions {
  authenticationTimeoutMs?: number;
  heartbeatIntervalMs?: number;
}

const parseAuthenticationMessage = (data: RawData): AuthenticationMessage | null => {
  const text = Array.isArray(data)
    ? Buffer.concat(data).toString('utf8')
    : Buffer.isBuffer(data)
      ? data.toString('utf8')
      : Buffer.from(data).toString('utf8');

  try {
    const value: unknown = JSON.parse(text);
    if (
      typeof value !== 'object' ||
      value === null ||
      (value as { type?: unknown }).type !== 'authenticate' ||
      typeof (value as { token?: unknown }).token !== 'string' ||
      Object.keys(value).some((key) => key !== 'token' && key !== 'type')
    ) {
      return null;
    }

    return value as AuthenticationMessage;
  } catch {
    return null;
  }
};

export class AuthenticatedRealtimeServer implements RealtimePublisher {
  private readonly authenticationTimeoutMs: number;
  private readonly clients = new Map<WebSocket, ClientState>();
  private readonly heartbeat: NodeJS.Timeout;
  private readonly webSocketServer: WebSocketServer;

  public constructor(
    server: Server,
    private readonly authenticationService: AuthenticationService,
    private readonly logger: Logger,
    options: RealtimeServerOptions = {},
  ) {
    this.authenticationTimeoutMs = options.authenticationTimeoutMs ?? AUTHENTICATION_TIMEOUT_MS;
    this.webSocketServer = new WebSocketServer({
      maxPayload: MAX_MESSAGE_BYTES,
      path: REALTIME_PATH,
      server,
    });
    this.webSocketServer.on('connection', (socket) => this.register(socket));
    this.webSocketServer.on('error', (error) => {
      this.logger.error('realtime_server_error', { errorType: error.name });
    });
    this.heartbeat = setInterval(
      () => this.runHeartbeat(),
      options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS,
    );
    this.heartbeat.unref();
  }

  public publish(storeId: string, type: RealtimeEventType): void {
    const message = JSON.stringify({
      eventId: randomUUID(),
      timestamp: new Date().toISOString(),
      type,
    });
    let recipients = 0;

    for (const [socket, state] of this.clients) {
      if (state.session?.storeId === storeId && socket.readyState === WebSocket.OPEN) {
        try {
          socket.send(message);
          recipients += 1;
        } catch (error: unknown) {
          this.logger.error('realtime_publish_failed', {
            connectionId: state.connectionId,
            errorType: error instanceof Error ? error.name : 'UnknownError',
            type,
          });
          socket.terminate();
        }
      }
    }

    this.logger.info('realtime_event_published', { recipients, storeId, type });
  }

  public async close(): Promise<void> {
    clearInterval(this.heartbeat);
    for (const socket of this.clients.keys()) {
      socket.close(1001, 'server_shutdown');
    }

    const terminationTimer = setTimeout(() => {
      for (const socket of this.clients.keys()) {
        socket.terminate();
      }
    }, 1_000);
    terminationTimer.unref();

    await new Promise<void>((resolve) => {
      this.webSocketServer.close(() => resolve());
    });
    clearTimeout(terminationTimer);
    this.clients.clear();
  }

  private register(socket: WebSocket): void {
    const connectionId = randomUUID();
    const state: ClientState = {
      authenticationPending: false,
      authenticationTimer: setTimeout(() => {
        socket.close(4408, 'authentication_timeout');
      }, this.authenticationTimeoutMs),
      connectionId,
      isAlive: true,
      session: null,
      validationPending: false,
    };
    this.clients.set(socket, state);
    this.logger.info('realtime_connected', { connectionId });

    socket.on('pong', () => {
      state.isAlive = true;
    });
    socket.on('message', (data) => {
      void this.handleMessage(socket, state, data);
    });
    socket.on('close', (code) => {
      clearTimeout(state.authenticationTimer);
      this.clients.delete(socket);
      this.logger.info('realtime_disconnected', { code, connectionId });
    });
    socket.on('error', (error) => {
      this.logger.error('realtime_client_error', { connectionId, errorType: error.name });
    });
  }

  private async handleMessage(socket: WebSocket, state: ClientState, data: RawData): Promise<void> {
    if (state.session || state.authenticationPending) {
      socket.close(1008, 'unexpected_message');
      return;
    }

    const message = parseAuthenticationMessage(data);
    if (!message) {
      socket.close(1008, 'invalid_message');
      return;
    }

    state.authenticationPending = true;
    try {
      const session = await this.authenticationService.authenticateSession(message.token);
      if (socket.readyState !== WebSocket.OPEN) {
        return;
      }

      clearTimeout(state.authenticationTimer);
      state.session = session;
      socket.send(JSON.stringify({ timestamp: new Date().toISOString(), type: 'authenticated' }));
      this.logger.info('realtime_authenticated', {
        connectionId: state.connectionId,
        employeeId: session.employeeId,
        storeId: session.storeId,
        userId: session.userId,
      });
    } catch (error: unknown) {
      this.logger.info('realtime_authentication_failed', {
        connectionId: state.connectionId,
        errorType: error instanceof Error ? error.name : 'UnknownError',
      });
      socket.close(4401, 'unauthorized');
    } finally {
      state.authenticationPending = false;
    }
  }

  private runHeartbeat(): void {
    for (const [socket, state] of this.clients) {
      if (!state.isAlive) {
        socket.terminate();
        continue;
      }

      state.isAlive = false;
      socket.ping();
      if (state.session && !state.validationPending) {
        void this.revalidateSession(socket, state);
      }
    }
  }

  private async revalidateSession(socket: WebSocket, state: ClientState): Promise<void> {
    state.validationPending = true;
    try {
      if (state.session) {
        state.session = await this.authenticationService.refreshSession(state.session);
      }
    } catch {
      socket.close(4401, 'unauthorized');
    } finally {
      state.validationPending = false;
    }
  }
}
