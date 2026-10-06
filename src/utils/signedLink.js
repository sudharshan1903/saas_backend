import crypto from 'node:crypto';
import { env } from '../config/env.js';

export function generateSignedInvoiceUrl(invoiceId, ttlHours = env.INVOICE_LINK_TTL_HOURS) {
  const expires = Math.floor(Date.now() / 1000) + ttlHours * 3600;
  const data = `${invoiceId}:${expires}`;
  const sig = crypto
    .createHmac('sha256', env.INVOICE_LINK_SECRET)
    .update(data)
    .digest('hex');

  const baseUrl = env.APP_BASE_URL.endsWith('/') ? env.APP_BASE_URL.slice(0, -1) : env.APP_BASE_URL;
  return `${baseUrl}/api/invoices/${encodeURIComponent(invoiceId)}/download?expires=${expires}&sig=${sig}`;
}

export function verifySignedInvoiceUrl(invoiceId, expires, sig) {
  if (!expires || !sig) return false;
  const expiresNum = Number(expires);
  if (!Number.isFinite(expiresNum)) return false;

  const nowSec = Math.floor(Date.now() / 1000);
  if (expiresNum < nowSec) return false;

  const data = `${invoiceId}:${expiresNum}`;
  const expectedSig = crypto
    .createHmac('sha256', env.INVOICE_LINK_SECRET)
    .update(data)
    .digest('hex');

  const sigBuffer = Buffer.from(sig);
  const expectedBuffer = Buffer.from(expectedSig);

  if (sigBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(sigBuffer, expectedBuffer);
}
