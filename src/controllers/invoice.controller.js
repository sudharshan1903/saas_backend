import { getInvoiceForDownload } from '../services/invoice.service.js';
import { verifySignedInvoiceUrl } from '../utils/signedLink.js';
import { AppError } from '../utils/AppError.js';
import crypto from 'node:crypto';
import { env } from '../config/env.js';

function isApiKeyAuthorized(req) {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey || typeof apiKey !== 'string') return false;

  const providedHash = crypto.createHash('sha256').update(apiKey.trim()).digest();
  const expectedHash = crypto.createHash('sha256').update(env.ADMIN_API_KEY).digest();

  if (providedHash.length !== expectedHash.length) return false;
  return crypto.timingSafeEqual(providedHash, expectedHash);
}

export async function downloadInvoice(req, res) {
  const { id } = req.params;
  const { expires, sig } = req.query;

  const hasApiKey = isApiKeyAuthorized(req);
  const hasValidSignedLink = verifySignedInvoiceUrl(id, expires, sig);

  if (!hasApiKey && !hasValidSignedLink) {
    throw new AppError('UNAUTHORIZED', 'Missing valid x-api-key header or valid signed download URL', 401);
  }

  const { fileName, buffer } = await getInvoiceForDownload(id);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.setHeader('Content-Length', buffer.length);
  res.send(buffer);
}
