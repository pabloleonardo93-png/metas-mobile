import 'dotenv/config';

import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createMetasApiClient } from './upstream/metasApiClient.js';

const config = loadConfig();
const app = createApp({ client: createMetasApiClient(config), config });

const server = app.listen(config.port, '0.0.0.0', () => {
  console.info(
    JSON.stringify({
      event: 'metas_admin_bff_started',
      nodeEnvironment: config.nodeEnvironment,
      port: config.port,
    }),
  );
});

const shutdown = (signal: string): void => {
  console.info(JSON.stringify({ event: 'metas_admin_bff_stopping', signal }));
  server.close((error) => {
    if (error) {
      console.error(JSON.stringify({ event: 'metas_admin_bff_shutdown_failed' }));
      process.exitCode = 1;
    }
  });
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
