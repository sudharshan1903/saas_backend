import { listExpiringSubscriptions, expireSubscriptions } from '../repositories/subscription.repo.js';
import { cacheService } from './cache.service.js';
import { pool } from '../config/db.js';

export async function getExpiringSubscriptions({ startIso, endIso }, db = pool) {
  return listExpiringSubscriptions({ startIso, endIso }, db);
}

export async function expirePastDueSubscriptions(cutoffIso, db = pool) {
  const rows = await expireSubscriptions(cutoffIso, db);
  if (rows.length > 0) {
    await cacheService.invalidate('stats:summary:*');
  }
  return rows;
}
