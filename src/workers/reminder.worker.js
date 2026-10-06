import { Worker } from 'bullmq';
import Redis from 'ioredis';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { RENEWAL_REMINDER_QUEUE } from '../queues/queues.js';
import { findSubscriptionById, markReminderSent } from '../repositories/subscription.repo.js';
import { sendReminderEmail } from '../services/email.service.js';

export function createReminderWorker(concurrency = env.WORKER_CONCURRENCY) {
  const connection = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableOfflineQueue: true,
  });

  const worker = new Worker(
    RENEWAL_REMINDER_QUEUE,
    async (job) => {
      const { subscriptionId } = job.data;
      if (!subscriptionId) {
        return { skipped: true, reason: 'missing_subscription_id' };
      }

      logger.info({ jobId: job.id, subscriptionId }, 'Processing renewal reminder job');

      const subscription = await findSubscriptionById(subscriptionId);
      if (!subscription) {
        logger.info({ subscriptionId }, 'Subscription no longer exists; skipping reminder');
        return { skipped: true, reason: 'not_found' };
      }

      if (subscription.status !== 'active') {
        logger.info({ subscriptionId, status: subscription.status }, 'Subscription is no longer active; skipping reminder');
        return { skipped: true, reason: 'not_active' };
      }

      if (subscription.reminder_sent) {
        logger.info({ subscriptionId }, 'Reminder already marked sent for subscription; skipping duplicate email');
        return { skipped: true, reason: 'already_sent' };
      }

      await sendReminderEmail({
        to: subscription.email,
        name: subscription.name,
        plan: subscription.plan,
        endDate: subscription.end_date,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
      });

      await markReminderSent(subscription.id);
      logger.info({ subscriptionId, to: subscription.email }, 'Successfully sent renewal reminder email');
      return { success: true, subscriptionId: subscription.id };
    },
    {
      connection,
      concurrency,
    },
  );

  worker.on('failed', (job, err) => {
    logger.error({ err, jobId: job?.id, subscriptionId: job?.data?.subscriptionId }, 'Reminder worker job failed');
  });

  worker.on('error', (err) => {
    logger.error({ err }, 'Reminder worker connection error');
  });

  return worker;
}
