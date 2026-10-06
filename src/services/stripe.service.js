import { stripe } from '../config/stripe.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { findUserByEmail } from '../repositories/user.repo.js';
import { AppError } from '../utils/AppError.js';

export async function createCheckoutSession({ email, name }) {
  const priceId = env.STRIPE_PRICE_ID;
  if (!priceId || priceId.includes('price_xxx') || priceId === 'price_...') {
    throw new AppError(
      'STRIPE_PRICE_NOT_CONFIGURED',
      'STRIPE_PRICE_ID must be configured with a valid test Stripe Price ID (starts with price_...) in src/.env.development',
      500,
    );
  }

  if (priceId.startsWith('prod_')) {
    throw new AppError(
      'INVALID_STRIPE_PRICE_ID',
      `STRIPE_PRICE_ID currently set to '${priceId}' is a Stripe Product ID (starts with prod_). Stripe Checkout requires a Price ID (starts with price_...). Please create a recurring Price under your Product in the Stripe Dashboard and paste its Price ID (price_...) into src/.env.development.`,
      400,
    );
  }

  const normalizedEmail = email.trim().toLowerCase();
  logger.info({ email: normalizedEmail, name }, 'Creating Stripe Checkout session');

  const existingUser = await findUserByEmail(normalizedEmail);

  const sessionOptions = {
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${env.CHECKOUT_SUCCESS_URL}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: env.CHECKOUT_CANCEL_URL,
    metadata: { email: normalizedEmail, name: name || '' },
    subscription_data: {
      metadata: { email: normalizedEmail, name: name || '' },
    },
  };

  if (existingUser?.stripe_customer_id) {
    sessionOptions.customer = existingUser.stripe_customer_id;
  } else {
    sessionOptions.customer_email = normalizedEmail;
  }

  try {
    const session = await stripe.checkout.sessions.create(sessionOptions);
    return { url: session.url, sessionId: session.id };
  } catch (error) {
    logger.error({ err: error.message }, 'Failed to create Stripe checkout session');
    throw new AppError('STRIPE_ERROR', `Stripe Checkout creation failed: ${error.message}`, 400);
  }
}

export async function fetchSubscription(subscriptionId) {
  if (!subscriptionId) return null;
  try {
    return await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ['items.data.price.product'],
    });
  } catch (error) {
    if (error.statusCode === 404 || error.code === 'resource_missing') {
      return null;
    }
    throw error;
  }
}

export async function fetchInvoice(invoiceId) {
  if (!invoiceId) return null;
  try {
    return await stripe.invoices.retrieve(invoiceId);
  } catch (error) {
    if (error.statusCode === 404 || error.code === 'resource_missing') {
      return null;
    }
    throw error;
  }
}
