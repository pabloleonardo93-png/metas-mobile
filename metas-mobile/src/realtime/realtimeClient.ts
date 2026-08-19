import type { SessionTokenStorage } from '@/features/auth/storage/sessionTokenStorage';
import type {
  RealtimeEventType,
  RealtimeListener,
  RealtimeSubscription,
} from '@/realtime/realtime.types';

const BASE_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const MAX_JITTER_MS = 250;
const SOCKET_CONNECTING = 0;
const SOCKET_OPEN = 1;
const UNAUTHORIZED_CLOSE_CODE = 4401;

interface RealtimeSocketMessageEvent {
  data: unknown;
}

interface RealtimeSocketCloseEvent {
  code: number;
}

export interface RealtimeSocket {
  readonly readyState: number;
  onclose: ((event: RealtimeSocketCloseEvent) => void) | null;
  onerror: (() => void) | null;
  onmessage: ((event: RealtimeSocketMessageEvent) => void) | null;
  onopen: (() => void) | null;
  close(code?: number, reason?: string): void;
  send(data: string): void;
}

interface RealtimeScheduler {
  clearTimeout(timer: ReturnType<typeof setTimeout>): void;
  setTimeout(callback: () => void, delay: number): ReturnType<typeof setTimeout>;
}

export interface RealtimeClientOptions {
  apiBaseUrl: string;
  createSocket?: (url: string) => RealtimeSocket;
  onUnauthorized: () => Promise<void> | void;
  random?: () => number;
  scheduler?: RealtimeScheduler;
  sessionTokenStorage: SessionTokenStorage;
}

interface DispatchState {
  rerun: boolean;
  running: boolean;
}

const eventTypes = new Set<RealtimeEventType>([
  'campaigns.changed',
  'employees.changed',
  'goal.configuration.changed',
]);

export const createRealtimeUrl = (apiBaseUrl: string): string => {
  const url = new URL(apiBaseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = `${url.pathname.replace(/\/$/, '')}/v1/realtime`;
  url.search = '';
  url.hash = '';
  return url.toString();
};

const defaultSocketFactory = (url: string): RealtimeSocket =>
  new WebSocket(url) as unknown as RealtimeSocket;

export class RealtimeClient {
  private active = false;
  private foreground = true;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private socket: RealtimeSocket | null = null;
  private readonly dispatchStates = new Map<RealtimeEventType, DispatchState>();
  private readonly listeners = new Map<RealtimeEventType, Set<RealtimeListener>>();
  private readonly createSocket: (url: string) => RealtimeSocket;
  private readonly random: () => number;
  private readonly scheduler: RealtimeScheduler;
  private readonly url: string;

  public constructor(private readonly options: RealtimeClientOptions) {
    this.createSocket = options.createSocket ?? defaultSocketFactory;
    this.random = options.random ?? Math.random;
    this.scheduler = options.scheduler ?? { clearTimeout, setTimeout };
    this.url = createRealtimeUrl(options.apiBaseUrl);
  }

  public start(): void {
    this.active = true;
    this.connect();
  }

  public stop(): void {
    this.active = false;
    this.cancelReconnect();
    this.closeCurrentSocket();
  }

  public setForeground(foreground: boolean): void {
    this.foreground = foreground;
    if (!foreground) {
      this.cancelReconnect();
      this.closeCurrentSocket();
      return;
    }

    this.connect();
  }

  public subscribe(type: RealtimeEventType, listener: RealtimeListener): RealtimeSubscription {
    const listeners = this.listeners.get(type) ?? new Set<RealtimeListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);

    return {
      unsubscribe: () => {
        listeners.delete(listener);
      },
    };
  }

  private connect(): void {
    if (!this.active || !this.foreground || this.hasActiveSocket()) {
      return;
    }

    this.cancelReconnect();
    let socket: RealtimeSocket;
    try {
      socket = this.createSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.socket = socket;
    socket.onopen = () => {
      void this.authenticate(socket);
    };
    socket.onmessage = (event) => this.handleMessage(socket, event.data);
    socket.onerror = () => undefined;
    socket.onclose = (event) => this.handleClose(socket, event.code);
  }

  private async authenticate(socket: RealtimeSocket): Promise<void> {
    try {
      const token = await this.options.sessionTokenStorage.getToken();
      if (socket !== this.socket || socket.readyState !== SOCKET_OPEN) {
        return;
      }
      if (!token) {
        socket.close(UNAUTHORIZED_CLOSE_CODE, 'missing_session');
        return;
      }

      socket.send(JSON.stringify({ token, type: 'authenticate' }));
    } catch {
      socket.close(1011, 'session_unavailable');
    }
  }

  private handleMessage(socket: RealtimeSocket, data: unknown): void {
    if (socket !== this.socket || typeof data !== 'string') {
      return;
    }

    let message: unknown;
    try {
      message = JSON.parse(data);
    } catch {
      return;
    }
    if (typeof message !== 'object' || message === null) {
      return;
    }

    const type = (message as { type?: unknown }).type;
    if (type === 'authenticated') {
      this.reconnectAttempt = 0;
      for (const resourceType of eventTypes) {
        this.dispatch(resourceType);
      }
      return;
    }
    if (typeof type === 'string' && eventTypes.has(type as RealtimeEventType)) {
      this.dispatch(type as RealtimeEventType);
    }
  }

  private handleClose(socket: RealtimeSocket, code: number): void {
    if (socket !== this.socket) {
      return;
    }

    this.socket = null;
    if (code === UNAUTHORIZED_CLOSE_CODE) {
      this.active = false;
      void Promise.resolve(this.options.onUnauthorized()).catch(() => undefined);
      return;
    }
    this.scheduleReconnect();
  }

  private dispatch(type: RealtimeEventType): void {
    const state = this.dispatchStates.get(type) ?? { rerun: false, running: false };
    this.dispatchStates.set(type, state);
    if (state.running) {
      state.rerun = true;
      return;
    }

    state.running = true;
    const listeners = [...(this.listeners.get(type) ?? [])];
    void Promise.allSettled(listeners.map(async (listener) => listener())).finally(() => {
      state.running = false;
      if (state.rerun) {
        state.rerun = false;
        this.dispatch(type);
      }
    });
  }

  private scheduleReconnect(): void {
    if (!this.active || !this.foreground || this.reconnectTimer) {
      return;
    }

    const exponentialDelay = Math.min(
      BASE_RECONNECT_DELAY_MS * 2 ** this.reconnectAttempt,
      MAX_RECONNECT_DELAY_MS,
    );
    const jitter = Math.floor(this.random() * MAX_JITTER_MS);
    this.reconnectAttempt += 1;
    this.reconnectTimer = this.scheduler.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, exponentialDelay + jitter);
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer) {
      this.scheduler.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private closeCurrentSocket(): void {
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState <= SOCKET_OPEN) {
      socket.close(1000, 'client_inactive');
    }
  }

  private hasActiveSocket(): boolean {
    return this.socket?.readyState === SOCKET_CONNECTING || this.socket?.readyState === SOCKET_OPEN;
  }
}
