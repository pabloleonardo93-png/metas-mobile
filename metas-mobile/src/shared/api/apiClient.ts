import { publicEnv } from '@/config/publicEnv';

const REQUEST_TIMEOUT_MS = 15_000;
let unauthorizedHandler: (() => Promise<void> | void) | null = null;

interface ApiErrorBody {
  code?: unknown;
  message?: unknown;
  requestId?: unknown;
}

interface ApiRequestOptions {
  body?: unknown;
  method?: 'GET' | 'PATCH' | 'POST' | 'PUT';
  sessionToken?: string;
}

export class ApiError extends Error {
  readonly code: string;
  readonly requestId?: string;
  readonly status: number | null;

  constructor(params: {
    code: string;
    message: string;
    requestId?: string;
    status: number | null;
  }) {
    super(params.message);
    this.name = 'ApiError';
    this.code = params.code;
    this.requestId = params.requestId;
    this.status = params.status;
  }
}

export function setUnauthorizedHandler(handler: (() => Promise<void> | void) | null): void {
  unauthorizedHandler = handler;
}

function readErrorBody(value: unknown): ApiErrorBody {
  return typeof value === 'object' && value !== null ? (value as ApiErrorBody) : {};
}

async function parseResponseBody(response: Response): Promise<unknown> {
  if (response.status === 204) {
    return undefined;
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return undefined;
  }

  return response.json().catch(() => undefined);
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  if (!publicEnv.isApiConfigured) {
    throw new ApiError({
      code: 'API_NOT_CONFIGURED',
      message: 'A API do aplicativo não está configurada.',
      status: null,
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const headers = new Headers({ Accept: 'application/json' });
    if (options.body !== undefined) {
      headers.set('Content-Type', 'application/json');
    }
    if (options.sessionToken) {
      headers.set('Authorization', `Bearer ${options.sessionToken}`);
    }

    const response = await fetch(`${publicEnv.apiBaseUrl}${path}`, {
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      headers,
      method: options.method ?? 'GET',
      signal: controller.signal,
    });
    const body = await parseResponseBody(response);

    if (!response.ok) {
      const errorBody = readErrorBody(body);
      if (response.status === 401 && options.sessionToken && unauthorizedHandler) {
        void Promise.resolve(unauthorizedHandler()).catch(() => undefined);
      }
      throw new ApiError({
        code: typeof errorBody.code === 'string' ? errorBody.code : 'HTTP_ERROR',
        message:
          typeof errorBody.message === 'string'
            ? errorBody.message
            : 'Não foi possível concluir a solicitação.',
        requestId: typeof errorBody.requestId === 'string' ? errorBody.requestId : undefined,
        status: response.status,
      });
    }

    return body as T;
  } catch (error: unknown) {
    if (error instanceof ApiError) {
      throw error;
    }

    throw new ApiError({
      code:
        error instanceof Error && error.name === 'AbortError' ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR',
      message: 'Não foi possível conectar ao servidor.',
      status: null,
    });
  } finally {
    clearTimeout(timeout);
  }
}
