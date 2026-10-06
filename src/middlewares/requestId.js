import crypto from 'node:crypto';

export function requestIdMiddleware(req, res, next) {
  const existingId = req.headers['x-request-id'];
  const reqId = typeof existingId === 'string' && existingId.trim() ? existingId.trim() : crypto.randomUUID();
  req.id = reqId;
  res.setHeader('X-Request-Id', reqId);
  next();
}
