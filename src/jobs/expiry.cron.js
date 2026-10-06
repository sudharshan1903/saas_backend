import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import cron from 'node-cron';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { redis, closeRedis } from '../config/redis.js';
import { closeDb } from '../config/db.js';
import { listExpiringSubscriptions } from '../repositories/subscription.repo.js';
import { expirePastDueSubscriptions } from '../services/subscription.service.js';
import { listUnsentPaidPayments } from '../repositories/payment.repo.js';
import { renewalReminderQueue, invoiceEmailQueue, closeQueues } from '../queues/queues.js';
import { cacheService } from '../services/cache.service.js';
import { withTimeout } from '../utils/async.js';

let isCycleRunning = false;
const LOCK_KEY = 'saas:jobs:expiry-lock';

async function acquireCronLock(token, ttlSeconds = 300) {
  try {
    const res = await redis.set(LOCK_KEY, token, 'EX', ttlSeconds, 'NX');
    return res === 'OK';
  } catch (err) {
    logger.warn({ err: err.message }, 'Failed to acquire cron lock in Redis; proceeding with in-memory guard');
    return true;
  }
}

async function releaseCronLock(token) {
  try {
    const lua = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    await redis.eval(lua, 1, LOCK_KEY, token);
  } catch (err) {
    logger.warn({ err: err.message }, 'Failed to release cron lock in Redis');
  }
}

export async function runExpiryCycle() {
  if (isCycleRunning) {
    logger.info('Skipping cron cycle: in-process execution is already running');
    return;
  }

  isCycleRunning = true;
  const token = crypto.randomUUID();
  const lockAcquired = await acquireCronLock(token, 300);

  if (!lockAcquired) {
    logger.info('Skipping cron cycle: another process holds the Redis lock');
    isCycleRunning = false;
    return;
  }

  logger.info('Starting subscription expiry & reminder sweep cycle...');

  try {
    const now = new Date();

    // Step 1: Expire active subscriptions past their grace period
    const graceCutoff = new Date(now.getTime() - env.EXPIRY_GRACE_HOURS * 3600 * 1000).toISOString();
    const expiredSubs = await expirePastDueSubscriptions(graceCutoff);
    logger.info({ count: expiredSubs.length, cutoff: graceCutoff }, 'Expired past-due subscriptions');

    // Step 2: Select active subscriptions approaching expiration and enqueue reminders
    const nowIso = now.toISOString();
    const endWindow = new Date(now.getTime() + env.REMINDER_DAYS_BEFORE * 24 * 3600 * 1000).toISOString();

    const expiringSubs = await listExpiringSubscriptions({ startIso: nowIso, endIso: endWindow });
    logger.info({ count: expiringSubs.length, windowStart: nowIso, windowEnd: endWindow }, 'Found expiring subscriptions needing reminders');

    let remindersQueued = 0;
    for (const sub of expiringSubs) {
      const epochEnd = new Date(sub.end_date).getTime();
      const jobId = `reminder-${sub.id}-${epochEnd}`;

      try {
        await withTimeout(
          renewalReminderQueue.add(
            'send-renewal-reminder',
            { subscriptionId: sub.id },
            { jobId },
          ),
          3000,
        );
        remindersQueued += 1;
      } catch (err) {
        logger.error({ err: err.message, subscriptionId: sub.id, jobId }, 'Failed to enqueue renewal reminder job');
      }
    }
    logger.info({ count: remindersQueued }, 'Enqueued renewal reminder jobs');

    // Step 3: Sweeper: re-enqueue unconfirmed paid invoice email jobs
    const unsentPayments = await listUnsentPaidPayments({ olderThanMinutes: 2, youngerThanHours: 48 });
    logger.info({ count: unsentPayments.length }, 'Sweeper found unsent paid invoice emails');

    let invoiceEmailsRequeued = 0;
    for (const p of unsentPayments) {
      const jobId = `invoice-email-${p.payment_id}`;
      try {
        await withTimeout(
          invoiceEmailQueue.add(
            'send-invoice-email',
            { paymentId: p.payment_id },
            { jobId },
          ),
          3000,
        );
        invoiceEmailsRequeued += 1;
      } catch (err) {
        logger.error({ err: err.message, paymentId: p.payment_id, jobId }, 'Sweeper failed to re-enqueue invoice email job');
      }
    }
    logger.info({ count: invoiceEmailsRequeued }, 'Sweeper re-enqueued invoice email jobs');

    if (expiredSubs.length > 0 || remindersQueued > 0) {
      await cacheService.invalidate('stats:summary:*');
    }

    logger.info('Subscription expiry & reminder sweep cycle finished successfully');
  } catch (error) {
    logger.error({ err: error }, 'Error occurred during subscription expiry sweep cycle');
  } finally {
    await releaseCronLock(token);
    isCycleRunning = false;
  }
}

// Entry guard: start scheduler only when executed directly (npm run cron)
const currentFile = fileURLToPath(import.meta.url);
const executedFile = process.argv[1] ? path.resolve(process.argv[1]) : '';

if (executedFile === currentFile || pathToFileURL(executedFile).href === import.meta.url) {
  if (!cron.validate(env.CRON_SCHEDULE)) {
    logger.error({ schedule: env.CRON_SCHEDULE }, 'Invalid CRON_SCHEDULE expression');
    process.exit(1);
  }

  logger.info({ schedule: env.CRON_SCHEDULE, timezone: env.CRON_TIMEZONE }, 'Starting subscription cron scheduler...');

  if (env.CRON_RUN_ON_START) {
    logger.info('CRON_RUN_ON_START is true; running initial sweep cycle immediately...');
    runExpiryCycle().catch((err) => logger.error({ err }, 'Initial cron run failed'));
  }

  cron.schedule(
    env.CRON_SCHEDULE,
    () => {
      runExpiryCycle().catch((err) => logger.error({ err }, 'Scheduled cron run failed'));
    },
    { timezone: env.CRON_TIMEZONE },
  );

  let isShuttingDown = false;
  async function shutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.info({ signal }, 'Shutting down subscription cron scheduler...');
    try {
      await closeQueues();
      await Promise.all([closeDb(), closeRedis()]);
      logger.info('Subscription cron scheduler shut down completely');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during cron scheduler shutdown');
      process.exit(1);
    }
  }

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}
