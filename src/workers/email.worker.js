import { Worker, UnrecoverableError } from 'bullmq';
import Redis from 'ioredis';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { INVOICE_EMAIL_QUEUE } from '../queues/queues.js';
import { ensureInvoiceForPayment } from '../services/invoice.service.js';
import { sendInvoiceEmail } from '../services/email.service.js';
import { findPaymentDetailsForInvoice } from '../repositories/payment.repo.js';
import { markInvoiceEmailSent } from '../repositories/invoice.repo.js';
import { cacheService } from '../services/cache.service.js';

export function createEmailWorker(concurrency = env.WORKER_CONCURRENCY) {
  const connection = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableOfflineQueue: true,
  });

  const worker = new Worker(
    INVOICE_EMAIL_QUEUE,
    async (job) => {
      const { paymentId } = job.data;
      if (!paymentId) {
        throw new UnrecoverableError('Job data missing paymentId');
      }

      logger.info({ jobId: job.id, paymentId }, 'Processing invoice email job');

      const payment = await findPaymentDetailsForInvoice(paymentId);
      if (!payment) {
        throw new UnrecoverableError(`Payment ${paymentId} not found in database`);
      }

      const invoice = await ensureInvoiceForPayment(paymentId);

      if (invoice.email_sent_at) {
        logger.info({ invoiceId: invoice.id, paymentId }, 'Invoice email already sent; skipping duplicate delivery');
        return { skipped: true };
      }

      await sendInvoiceEmail({
        to: payment.user_email,
        name: payment.user_name,
        plan: payment.plan,
        amountCents: payment.amount_cents,
        currency: payment.currency,
        invoiceNumber: invoice.invoice_number,
        invoiceId: invoice.id,
        invoicePath: invoice.fullPath,
        paidAt: payment.paid_at,
      });

      await markInvoiceEmailSent(invoice.id);
      await cacheService.invalidate('stats:summary:*');

      logger.info({ invoiceId: invoice.id, to: payment.user_email }, 'Successfully delivered invoice email');
      return { success: true, invoiceId: invoice.id };
    },
    {
      connection,
      concurrency,
    },
  );

  worker.on('failed', (job, err) => {
    logger.error({ err, jobId: job?.id, paymentId: job?.data?.paymentId }, 'Invoice email worker job failed');
  });

  worker.on('error', (err) => {
    logger.error({ err }, 'Invoice email worker connection error');
  });

  return worker;
}
