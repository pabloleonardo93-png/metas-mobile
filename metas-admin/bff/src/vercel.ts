import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createMetasApiClient } from './upstream/metasApiClient.js';

export const createVercelApp = (environment: NodeJS.ProcessEnv = process.env) => {
  const config = loadConfig(environment);
  return createApp({
    client: createMetasApiClient(config),
    config,
    staticDirectory: null,
  });
};
