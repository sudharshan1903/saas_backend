import { withTransaction } from '../config/db.js';
import { logger } from '../config/logger.js';
import { insertProcessedEvent, hasProcessedEvent } from '../repositories/event.repo.js';
import { findUserByStripeCustomerId, upsertUser } from '../repositories/user.repo.js';
import { upsertSubscription, findSubscriptionByStripeId } from '../repositories/subscription.repo.js';
import { upsertPayment } from '../repositories/payment.repo.js';
import { fetchSubscription } from './stripe.service.js';
import { cacheService } from './cache.service.js';
import { invoiceEmailQueue } from '../queues/queues.js';
import {
  extractPeriodEnd,
  extractPeriodStart,
  extractInvoiceSubscriptionId,
  extractCustomerId,
  extractAmountPaidCents,
} from '../utils/stripeMapper.js';
import { timestampToIso } from '../utils/dates.js';
import { withTimeout } from '../utils/async.js';

export async function processStripeWebhook(event) {
  const alreadyProcessed = await hasProcessedEvent(event.id);
  if (alreadyProcessed) {
    logger.info({ eventId: event.id, eventType: event.type }, 'Webhook pre-check: duplicate event');
    return { duplicate: true };
  }

  const object = event.data?.object || {};

  let preparedSubscription = null;
  const targetSubId = extractInvoiceSubscriptionId(object) || (object.object === 'subscription' ? object.id : null) || extractCustomerId(object.subscription);

  if (targetSubId) {
    try {
      preparedSubscription = await fetchSubscription(targetSubId);
    } catch (err) {
      logger.warn({ err: err.message, targetSubId }, 'Stripe subscription retrieve failed during preparation');
    }
  }

  let paymentToEnqueue = null;

  const txResult = await withTransaction(async (tx) => {
    const inserted = await insertProcessedEvent(event.id, event.type, tx);
    if (!inserted) {
      return { duplicate: true };
    }

    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        if (object.mode && object.mode !== 'subscription') break;

        const subId = targetSubId || (object.subscription ? extractCustomerId(object.subscription) : null);
        const subData = preparedSubscription || (subId ? { id: subId } : null);
        if (!subData || !subData.id) break;

        const customerId = extractCustomerId(object.customer) || (subData ? extractCustomerId(subData.customer) : null) || `cus_${event.id}`;
        const email = object.customer_details?.email || object.customer_email || object.metadata?.email || subData?.metadata?.email || `${customerId}@example.com`;
        const name = object.customer_details?.name || object.metadata?.name || subData?.metadata?.name || 'Customer';

        let user = await findUserByStripeCustomerId(customerId, tx);
        if (!user) {
          user = await upsertUser({ email, name, stripeCustomerId: customerId }, tx);
        }

        const priceObj = subData.items?.data?.[0]?.price;
        await upsertSubscription(
          {
            userId: user.id,
            stripeSubscriptionId: subData.id,
            stripePriceId: priceObj?.id || null,
            plan: priceObj?.nickname || (typeof priceObj?.product === 'object' ? priceObj.product.name : null) || 'Subscription',
            stripeStatus: subData.status || 'active',
            amountCents: priceObj?.unit_amount || 0,
            currency: priceObj?.currency || 'usd',
            billingInterval: priceObj?.recurring?.interval || 'month',
            intervalCount: priceObj?.recurring?.interval_count || 1,
            startDate: timestampToIso(extractPeriodStart(subData)) || new Date().toISOString(),
            endDate: timestampToIso(extractPeriodEnd(subData)) || new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
            cancelAtPeriodEnd: Boolean(subData.cancel_at_period_end),
          },
          tx,
        );
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
      case 'customer.subscription.paused':
      case 'customer.subscription.resumed': {
        const subData = preparedSubscription || object;
        if (!subData || !subData.id) break;

        const customerId = extractCustomerId(subData.customer) || `cus_${subData.id}`;
        const email = subData.metadata?.email || `${customerId}@example.com`;
        const name = subData.metadata?.name || 'Customer';

        let user = await findUserByStripeCustomerId(customerId, tx);
        if (!user) {
          user = await upsertUser({ email, name, stripeCustomerId: customerId }, tx);
        }

        const priceObj = subData.items?.data?.[0]?.price;
        await upsertSubscription(
          {
            userId: user.id,
            stripeSubscriptionId: subData.id,
            stripePriceId: priceObj?.id || null,
            plan: priceObj?.nickname || (typeof priceObj?.product === 'object' ? priceObj.product.name : null) || 'Subscription',
            stripeStatus: subData.status || 'active',
            amountCents: priceObj?.unit_amount || 0,
            currency: priceObj?.currency || 'usd',
            billingInterval: priceObj?.recurring?.interval || 'month',
            intervalCount: priceObj?.recurring?.interval_count || 1,
            startDate: timestampToIso(extractPeriodStart(subData)) || new Date().toISOString(),
            endDate: timestampToIso(extractPeriodEnd(subData)) || new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
            cancelAtPeriodEnd: Boolean(subData.cancel_at_period_end),
          },
          tx,
        );
        break;
      }

      case 'invoice.paid':
      case 'invoice.payment_succeeded': {
        const stripeSubId = extractInvoiceSubscriptionId(object) || targetSubId;
        if (!stripeSubId) break;

        const subData = preparedSubscription || { id: stripeSubId };
        const customerId = extractCustomerId(object.customer) || (subData ? extractCustomerId(subData.customer) : null) || `cus_${stripeSubId}`;
        const email = object.customer_email || subData?.metadata?.email || `${customerId}@example.com`;
        const name = object.customer_name || subData?.metadata?.name || 'Customer';

        let user = await findUserByStripeCustomerId(customerId, tx);
        if (!user) {
          user = await upsertUser({ email, name, stripeCustomerId: customerId }, tx);
        }

        let subscription = await findSubscriptionByStripeId(stripeSubId, tx);
        if (!subscription) {
          const priceObj = subData.items?.data?.[0]?.price;
          subscription = await upsertSubscription(
            {
              userId: user.id,
              stripeSubscriptionId: stripeSubId,
              stripePriceId: priceObj?.id || null,
              plan: priceObj?.nickname || (typeof priceObj?.product === 'object' ? priceObj.product.name : null) || 'Subscription',
              stripeStatus: subData.status || 'active',
              amountCents: priceObj?.unit_amount || 2900,
              currency: priceObj?.currency || object.currency || 'usd',
              billingInterval: priceObj?.recurring?.interval || 'month',
              intervalCount: priceObj?.recurring?.interval_count || 1,
              startDate: timestampToIso(extractPeriodStart(subData)) || new Date().toISOString(),
              endDate: timestampToIso(extractPeriodEnd(subData)) || new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
              cancelAtPeriodEnd: Boolean(subData.cancel_at_period_end),
            },
            tx,
          );
        }

        if (subscription) {
          const amountCents = extractAmountPaidCents(object) || subscription.amount_cents || 2900;
          const paidAtIso = timestampToIso(object.status_transitions?.paid_at) || new Date().toISOString();

          const payment = await upsertPayment(
            {
              subscriptionId: subscription.id,
              stripeInvoiceId: object.id || `in_${Date.now()}`,
              stripePaymentIntentId: extractCustomerId(object.payment_intent),
              amountCents,
              currency: object.currency || subscription.currency || 'usd',
              status: 'paid',
              paidAt: paidAtIso,
            },
            tx,
          );

          paymentToEnqueue = payment;
        }
        break;
      }

      case 'invoice.payment_failed': {
        const stripeSubId = extractInvoiceSubscriptionId(object) || targetSubId;
        if (!stripeSubId) break;

        let subscription = await findSubscriptionByStripeId(stripeSubId, tx);
        const subData = preparedSubscription;

        if (subscription && subData) {
          const priceObj = subData.items?.data?.[0]?.price;
          subscription = await upsertSubscription(
            {
              userId: subscription.user_id,
              stripeSubscriptionId: stripeSubId,
              stripePriceId: priceObj?.id || null,
              plan: subscription.plan,
              stripeStatus: 'past_due',
              amountCents: subscription.amount_cents,
              currency: subscription.currency,
              billingInterval: subscription.billing_interval,
              intervalCount: subscription.interval_count,
              startDate: timestampToIso(extractPeriodStart(subData)),
              endDate: timestampToIso(extractPeriodEnd(subData)),
              cancelAtPeriodEnd: Boolean(subData.cancel_at_period_end),
            },
            tx,
          );

          const amountCents = extractAmountPaidCents(object);
          await upsertPayment(
            {
              subscriptionId: subscription.id,
              stripeInvoiceId: object.id || `in_fail_${Date.now()}`,
              stripePaymentIntentId: extractCustomerId(object.payment_intent),
              amountCents,
              currency: object.currency || subscription.currency || 'usd',
              status: 'failed',
              paidAt: null,
            },
            tx,
          );
        }
        break;
      }

      default:
        logger.info({ eventType: event.type }, 'Unhandled Stripe event type');
        break;
    }

    return { duplicate: false };
  });

  if (!txResult.duplicate) {
    await cacheService.invalidate('stats:summary:*');

    if (paymentToEnqueue) {
      try {
        const jobId = `invoice-email-${paymentToEnqueue.id}`;
        await withTimeout(
          invoiceEmailQueue.add(
            'send-invoice-email',
            { paymentId: paymentToEnqueue.id },
            { jobId },
          ),
          4000,
          'Invoice email queue add timeout',
        );
        logger.info({ jobId, paymentId: paymentToEnqueue.id }, 'Enqueued invoice email job');
      } catch (err) {
        logger.error({ err: err.message, paymentId: paymentToEnqueue.id }, 'Failed to enqueue invoice email job after webhook commit');
      }
    }
  }

  return txResult;
}
