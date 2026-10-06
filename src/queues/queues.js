import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { env } from '../config/env.js';

export const INVOICE_EMAIL_QUEUE = 'invoice-email';
export const RENEWAL_REMINDER_QUEUE = 'renewal-reminders';

const redisConnection = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableOfflineQueue: true,
});

const defaultJobOptions = {
  attempts: 5,
  backoff: {
    type: 'exponential',
    delay: 5000,
  },
  removeOnComplete: {
    age: 24 * 3600,
    count: 1000,
  },
  removeOnFail: {
    age: 24 * 3600,
    count: 1000,
  },
};

export const invoiceEmailQueue = new Queue(INVOICE_EMAIL_QUEUE, {
  connection: redisConnection,
  defaultJobOptions,
});

export const renewalReminderQueue = new Queue(RENEWAL_REMINDER_QUEUE, {
  connection: redisConnection,
  defaultJobOptions,
});

export async function closeQueues() {
  await Promise.all([
    invoiceEmailQueue.close(),
    renewalReminderQueue.close(),
  ]);
  if (redisConnection.status === 'ready' || redisConnection.status === 'connecting') {
    await redisConnection.quit();
  }
}
