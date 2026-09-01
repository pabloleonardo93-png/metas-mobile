import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import type { Request, RequestHandler, Response } from 'express';

import type { AdminBffConfig } from '../config.js';
import { BffError } from '../errors.js';
import { parseCookies, readSessionToken, setCsrfCookie } from '../http/cookies.js';

const CSRF_TTL_MS = 30 * 60 * 1_000;
const CSRF_TOKEN_PATTERN =
  /^(anonymous|session)\.([A-Za-z0-9_-]{32,128})\.(\d{13})\.([A-Za-z0-9_-]{43})$/u;

const sha256 = (value: string): string => createHash('sha256').update(value).digest('base64url');

const sessionBinding = (sessionToken: string | null): string =>
  sessionToken === null ? 'anonymous' : sha256(sessionToken);

const signatureFor = (
  mode: 'anonymous' | 'session',
  nonce: string,
  expiresAt: string,
  sessionToken: string | null,
  secret: string,
): string =>
  createHmac('sha256', secret)
    .update(`${mode}.${nonce}.${expiresAt}.${sessionBinding(sessionToken)}`)
    .digest('base64url');

const safeEqual = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
};

export const issueCsrfToken = (
  response: Response,
  config: AdminBffConfig,
  sessionToken: string | null,
): string => {
  const mode = sessionToken === null ? 'anonymous' : 'session';
  const nonce = randomBytes(32).toString('base64url');
  const expiresAt = String(Date.now() + CSRF_TTL_MS);
  const signature = signatureFor(mode, nonce, expiresAt, sessionToken, config.csrfSecret);
  const token = `${mode}.${nonce}.${expiresAt}.${signature}`;
  setCsrfCookie(response, token, config);
  return token;
};

const validateTrustedRequest = (request: Request, config: AdminBffConfig): void => {
  if (request.get('host') !== config.expectedHost) {
    throw new BffError(403, 'UNTRUSTED_HOST', 'Origem da requisição não autorizada.');
  }
  if (request.get('origin') !== config.publicOrigin) {
    throw new BffError(403, 'UNTRUSTED_ORIGIN', 'Origem da requisição não autorizada.');
  }
};

const validateCsrfToken = (request: Request, config: AdminBffConfig): void => {
  const cookies = parseCookies(request.get('cookie'));
  const cookieToken = cookies[config.csrfCookieName];
  const headerToken = request.get('x-csrf-token');
  if (!cookieToken || !headerToken || !safeEqual(cookieToken, headerToken)) {
    throw new BffError(403, 'CSRF_VALIDATION_FAILED', 'Validação de segurança expirada.');
  }

  const match = CSRF_TOKEN_PATTERN.exec(cookieToken);
  if (!match) {
    throw new BffError(403, 'CSRF_VALIDATION_FAILED', 'Validação de segurança expirada.');
  }
  const [, mode, nonce, expiresAt, signature] = match;
  if (!mode || !nonce || !expiresAt || !signature || Number(expiresAt) <= Date.now()) {
    throw new BffError(403, 'CSRF_VALIDATION_FAILED', 'Validação de segurança expirada.');
  }

  const sessionToken = readSessionToken(request.get('cookie'), config);
  if ((mode === 'session') !== (sessionToken !== null)) {
    throw new BffError(403, 'CSRF_VALIDATION_FAILED', 'Validação de segurança expirada.');
  }
  const expected = signatureFor(
    mode as 'anonymous' | 'session',
    nonce,
    expiresAt,
    sessionToken,
    config.csrfSecret,
  );
  if (!safeEqual(signature, expected)) {
    throw new BffError(403, 'CSRF_VALIDATION_FAILED', 'Validação de segurança expirada.');
  }
};

export const createCsrfProtection =
  (config: AdminBffConfig): RequestHandler =>
  (request, _response, next) => {
    try {
      validateTrustedRequest(request, config);
      validateCsrfToken(request, config);
      next();
    } catch (error) {
      next(error);
    }
  };

export const createApiHostProtection =
  (config: AdminBffConfig): RequestHandler =>
  (request, _response, next) => {
    if (request.get('host') !== config.expectedHost) {
      next(new BffError(403, 'UNTRUSTED_HOST', 'Origem da requisição não autorizada.'));
      return;
    }
    next();
  };
