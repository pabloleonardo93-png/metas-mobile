import type { RequestListener } from 'node:http';

import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createMetasApiClient } from './upstream/metasApiClient.js';

const routedPathQueryParameter = 'path';
const routedPathPattern = /^(?:[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)?$/u;
const invalidRoutePath = '/api/__invalid_vercel_route__';

const resolveExpressRequestUrl = (requestUrl: string | undefined): string => {
  if (!requestUrl) return invalidRoutePath;

  try {
    const url = new URL(requestUrl, 'http://vercel.internal');
    const routedPaths = url.searchParams.getAll(routedPathQueryParameter);
    url.searchParams.delete(routedPathQueryParameter);
    const routedPath = routedPaths[0];
    if (
      routedPaths.length !== 1 ||
      routedPath === undefined ||
      !routedPathPattern.test(routedPath)
    ) {
      return invalidRoutePath;
    }

    const query = url.searchParams.toString();
    const pathname = routedPath ? `/api/${routedPath}` : '/api';
    return query ? `${pathname}?${query}` : pathname;
  } catch {
    return invalidRoutePath;
  }
};

export const createVercelApp = (environment: NodeJS.ProcessEnv = process.env) => {
  const config = loadConfig(environment);
  return createApp({
    client: createMetasApiClient(config),
    config,
    staticDirectory: null,
  });
};

export const createVercelHandler = (
  environment: NodeJS.ProcessEnv = process.env,
): RequestListener => {
  const app = createVercelApp(environment);
  return (request, response) => {
    request.url = resolveExpressRequestUrl(request.url);
    app(request, response);
  };
};
