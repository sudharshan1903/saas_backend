import { redis } from '../config/redis.js';
import { logger } from '../config/logger.js';

export class CacheService {
  constructor(prefix = 'saas:') {
    this.prefix = prefix;
  }

  getKey(key) {
    return `${this.prefix}${key}`;
  }

  async get(key, fallback = null) {
    try {
      const raw = await redis.get(this.getKey(key));
      if (raw === null || raw === undefined) return fallback;
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    } catch (error) {
      logger.warn({ err: error.message, key }, 'Redis cache get failed; returning fallback');
      return fallback;
    }
  }

  async set(key, value, ttlSeconds = 300) {
    try {
      const payload = typeof value === 'string' ? value : JSON.stringify(value);
      await redis.set(this.getKey(key), payload, 'EX', ttlSeconds);
    } catch (error) {
      logger.warn({ err: error.message, key }, 'Redis cache set failed; ignoring error');
    }
  }

  async del(key) {
    try {
      await redis.del(this.getKey(key));
    } catch (error) {
      logger.warn({ err: error.message, key }, 'Redis cache del failed; ignoring error');
    }
  }

  async invalidate(pattern = 'stats:summary:*') {
    try {
      let cursor = '0';
      const searchPattern = `${this.prefix}${pattern}`;
      do {
        const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', searchPattern, 'COUNT', 100);
        cursor = nextCursor;
        if (keys.length > 0) {
          await redis.del(...keys);
        }
      } while (cursor !== '0');
    } catch (error) {
      logger.warn({ err: error.message, pattern }, 'Redis cache invalidate failed; ignoring error');
    }
  }

  async acquireLock(key, ttlSeconds = 5) {
    try {
      const res = await redis.set(this.getKey(`lock:${key}`), '1', 'EX', ttlSeconds, 'NX');
      return res === 'OK';
    } catch (error) {
      logger.warn({ err: error.message, key }, 'Redis acquireLock failed');
      return false;
    }
  }

  async releaseLock(key) {
    try {
      await redis.del(this.getKey(`lock:${key}`));
    } catch (error) {
      logger.warn({ err: error.message, key }, 'Redis releaseLock failed');
    }
  }
}

export const cacheService = new CacheService('saas:');
