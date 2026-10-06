import createApp from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { closeDb } from './config/db.js';
import { closeRedis } from './config/redis.js';
import { createEmailWorker } from './workers/email.worker.js';
import { closeQueues } from './queues/queues.js';

const app = createApp();

// Automatically start background email worker with API server
const emailWorker = createEmailWorker();
logger.info('Background email worker active and listening for invoice jobs');

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, `HTTP Server running on port ${env.PORT}`);
});

let isShuttingDown = false;
function shutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info({ signal }, 'Shutting down HTTP server gracefully...');

  server.close((err) => {
    if (err) {
      logger.error({ err }, 'Error closing HTTP server listener');
    }
    Promise.all([emailWorker.close(), closeQueues(), closeDb(), closeRedis()])
      .then(() => {
        logger.info('Database, Redis, and Background Workers closed. Exit successful.');
        process.exit(err ? 1 : 0);
      })
      .catch((shutdownErr) => {
        logger.error({ err: shutdownErr }, 'Error closing connections during shutdown');
        process.exit(1);
      });
  });
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
