import Redis from 'ioredis';
import { env } from './env.js';
import { logger } from './logger.js';

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
  commandTimeout: 1500,
  retryStrategy(times) {
    const delay = Math.min(times * 100, 2000);
    return delay;
  },
});

redis.on('error', (err) => {
  logger.error({ err: err.message }, 'Redis connection/command error');
});

export async function closeRedis() {
  if (redis.status === 'ready' || redis.status === 'connecting') {
    await redis.quit();
  }
}
