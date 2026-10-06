import { createEmailWorker } from './email.worker.js';
import { createReminderWorker } from './reminder.worker.js';
import { closeQueues } from '../queues/queues.js';
import { closeDb } from '../config/db.js';
import { closeRedis } from '../config/redis.js';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';

logger.info({ concurrency: env.WORKER_CONCURRENCY }, 'Starting background workers...');

const emailWorker = createEmailWorker();
const reminderWorker = createReminderWorker();

logger.info('Background workers are running');

let isShuttingDown = false;
async function shutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info({ signal }, 'Shutting down background workers gracefully...');

  try {
    await Promise.all([
      emailWorker.close(),
      reminderWorker.close(),
    ]);
    await closeQueues();
    await Promise.all([closeDb(), closeRedis()]);
    logger.info('Background workers shut down completely');
    process.exit(0);
  } catch (error) {
    logger.error({ err: error }, 'Error during background workers shutdown');
    process.exit(1);
  }
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
