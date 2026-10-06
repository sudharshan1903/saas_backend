import { pool } from '../config/db.js';
import { redis } from '../config/redis.js';

export function getHealth(req, res) {
  res.status(200).json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
}

export async function getReadiness(req, res) {
  let dbOk = false;
  let redisOk = false;

  try {
    await pool.query('SELECT 1');
    dbOk = true;
  } catch {
    dbOk = false;
  }

  try {
    const pong = await redis.ping();
    redisOk = pong === 'PONG';
  } catch {
    redisOk = false;
  }

  const isReady = dbOk && redisOk;
  const statusCode = isReady ? 200 : 503;

  res.status(statusCode).json({
    status: isReady ? 'ready' : 'unhealthy',
    checks: {
      postgres: dbOk ? 'ok' : 'down',
      redis: redisOk ? 'ok' : 'down',
    },
    timestamp: new Date().toISOString(),
  });
}
