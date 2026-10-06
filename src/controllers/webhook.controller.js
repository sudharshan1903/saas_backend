import { stripe } from '../config/stripe.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { processStripeWebhook } from '../services/webhook.service.js';

export async function handleStripeWebhook(req, res) {
  const signature = req.headers['stripe-signature'];
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET;

  if (!signature || !webhookSecret || webhookSecret.includes('whsec_xxx') || webhookSecret === 'whsec_...') {
    throw new AppError('WEBHOOK_CONFIGURATION_ERROR', 'Stripe signature and valid webhook secret must be configured', 400);
  }

  if (!Buffer.isBuffer(req.body)) {
    throw new AppError('INVALID_WEBHOOK_BODY', 'Stripe webhook endpoint requires unparsed raw request body', 400);
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
  } catch (error) {
    throw new AppError('INVALID_SIGNATURE', `Stripe signature verification failed: ${error.message}`, 400);
  }

  const result = await processStripeWebhook(event);

  res.status(200).json({ received: true, duplicate: Boolean(result?.duplicate) });
}
