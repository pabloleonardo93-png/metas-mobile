import { z } from 'zod';

const rawEnvironmentSchema = z.object({
  METAS_ADMIN_API_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(30_000).default(8_000),
  METAS_ADMIN_CSRF_SECRET: z.string().min(32).max(512),
  METAS_ADMIN_EXPECTED_HOST: z.string().trim().min(1).max(255),
  METAS_ADMIN_PUBLIC_ORIGIN: z.url(),
  METAS_API_BASE_URL: z.url(),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4_174),
});

export interface AdminBffConfig {
  apiBaseUrl: string;
  apiTimeoutMs: number;
  csrfCookieName: string;
  csrfSecret: string;
  expectedHost: string;
  isProduction: boolean;
  nodeEnvironment: 'development' | 'production' | 'test';
  port: number;
  publicOrigin: string;
  sessionCookieName: string;
}

const parseOrigin = (value: string, field: string): URL => {
  const url = new URL(value);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error(`${field} deve ser uma origem HTTP(S) sem credenciais, caminho ou query.`);
  }
  return url;
};

export const loadConfig = (environment: NodeJS.ProcessEnv = process.env): AdminBffConfig => {
  const parsed = rawEnvironmentSchema.parse(environment);
  const publicOrigin = parseOrigin(parsed.METAS_ADMIN_PUBLIC_ORIGIN, 'METAS_ADMIN_PUBLIC_ORIGIN');
  const apiBaseUrl = parseOrigin(parsed.METAS_API_BASE_URL, 'METAS_API_BASE_URL');
  const isProduction = parsed.NODE_ENV === 'production';

  if (publicOrigin.host !== parsed.METAS_ADMIN_EXPECTED_HOST) {
    throw new Error('METAS_ADMIN_EXPECTED_HOST deve corresponder exatamente à origem pública.');
  }
  if (isProduction && (publicOrigin.protocol !== 'https:' || apiBaseUrl.protocol !== 'https:')) {
    throw new Error('As origens do Admin e da API devem usar HTTPS em produção.');
  }

  return {
    apiBaseUrl: apiBaseUrl.origin,
    apiTimeoutMs: parsed.METAS_ADMIN_API_TIMEOUT_MS,
    csrfCookieName: isProduction ? '__Host-metas-admin-csrf' : 'metas-admin-csrf-dev',
    csrfSecret: parsed.METAS_ADMIN_CSRF_SECRET,
    expectedHost: parsed.METAS_ADMIN_EXPECTED_HOST,
    isProduction,
    nodeEnvironment: parsed.NODE_ENV,
    port: parsed.PORT,
    publicOrigin: publicOrigin.origin,
    sessionCookieName: isProduction ? '__Host-metas-admin-session' : 'metas-admin-session-dev',
  };
};
