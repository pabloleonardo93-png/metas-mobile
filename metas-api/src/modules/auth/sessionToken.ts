import { createHash, randomBytes } from 'node:crypto';

const SESSION_TOKEN_BYTES = 32;
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

export const generateSessionToken = (): string =>
  randomBytes(SESSION_TOKEN_BYTES).toString('base64url');

export const isValidSessionTokenFormat = (token: string): boolean =>
  SESSION_TOKEN_PATTERN.test(token);

export const hashSessionToken = (token: string): Buffer =>
  createHash('sha256').update(token, 'utf8').digest();
