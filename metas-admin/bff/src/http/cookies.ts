import type { Response } from 'express';

import type { AdminBffConfig } from '../config.js';

export const parseCookies = (header: string | undefined): Readonly<Record<string, string>> => {
  if (!header) return {};

  const cookies: Record<string, string> = {};
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    const encodedValue = part.slice(separator + 1).trim();
    try {
      cookies[name] = decodeURIComponent(encodedValue);
    } catch {
      continue;
    }
  }
  return cookies;
};

interface CookieOptions {
  httpOnly: boolean;
  maxAge?: number;
  secure: boolean;
}

const serializeCookie = (name: string, value: string, options: CookieOptions): string => {
  const attributes = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'SameSite=Strict',
    ...(options.httpOnly ? ['HttpOnly'] : []),
    ...(options.secure ? ['Secure'] : []),
    ...(options.maxAge === undefined ? [] : [`Max-Age=${options.maxAge}`]),
  ];
  return attributes.join('; ');
};

export const readSessionToken = (
  cookieHeader: string | undefined,
  config: AdminBffConfig,
): string | null => parseCookies(cookieHeader)[config.sessionCookieName] ?? null;

export const setSessionCookie = (
  response: Response,
  token: string,
  config: AdminBffConfig,
): void => {
  response.append(
    'Set-Cookie',
    serializeCookie(config.sessionCookieName, token, {
      httpOnly: true,
      secure: config.isProduction,
    }),
  );
};

export const clearSessionCookie = (response: Response, config: AdminBffConfig): void => {
  response.append(
    'Set-Cookie',
    serializeCookie(config.sessionCookieName, '', {
      httpOnly: true,
      maxAge: 0,
      secure: config.isProduction,
    }),
  );
};

export const setCsrfCookie = (response: Response, token: string, config: AdminBffConfig): void => {
  response.append(
    'Set-Cookie',
    serializeCookie(config.csrfCookieName, token, {
      httpOnly: false,
      secure: config.isProduction,
    }),
  );
};
