import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';

function sha256(str) {
  return crypto.createHash('sha256').update(String(str)).digest();
}

export function requireApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey || typeof apiKey !== 'string') {
    return next(new AppError('UNAUTHORIZED', 'Missing required x-api-key header', 401));
  }

  const providedHash = sha256(apiKey.trim());
  const expectedHash = sha256(env.ADMIN_API_KEY);

  if (providedHash.length !== expectedHash.length || !crypto.timingSafeEqual(providedHash, expectedHash)) {
    return next(new AppError('UNAUTHORIZED', 'Invalid API key provided', 401));
  }

  next();
}
