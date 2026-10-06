import { pool } from '../config/db.js';
import { mapStripeStatus } from '../utils/stripeMapper.js';

export async function findSubscriptionByStripeId(stripeSubscriptionId, db = pool) {
  if (!stripeSubscriptionId) return null;
  const { rows } = await db.query(
    'SELECT * FROM subscriptions WHERE stripe_subscription_id = $1 LIMIT 1',
    [stripeSubscriptionId],
  );
  return rows[0] || null;
}

export async function findSubscriptionById(id, db = pool) {
  const { rows } = await db.query(
    'SELECT s.*, u.email, u.name FROM subscriptions s JOIN users u ON u.id = s.user_id WHERE s.id = $1 LIMIT 1',
    [id],
  );
  return rows[0] || null;
}

export async function upsertSubscription({
  userId,
  stripeSubscriptionId,
  stripePriceId,
  plan,
  stripeStatus,
  amountCents,
  currency,
  billingInterval,
  intervalCount,
  startDate,
  endDate,
  cancelAtPeriodEnd,
}, db = pool) {
  const mappedStatus = mapStripeStatus(stripeStatus);

  try {
    const { rows } = await db.query(
      `INSERT INTO subscriptions (
        user_id, stripe_subscription_id, stripe_price_id, plan, status, stripe_status,
        amount_cents, currency, billing_interval, interval_count, start_date, end_date,
        cancel_at_period_end, reminder_sent
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, false)
      ON CONFLICT (stripe_subscription_id) DO UPDATE SET
        user_id = EXCLUDED.user_id,
        stripe_price_id = COALESCE(EXCLUDED.stripe_price_id, subscriptions.stripe_price_id),
        plan = COALESCE(EXCLUDED.plan, subscriptions.plan),
        status = EXCLUDED.status,
        stripe_status = EXCLUDED.stripe_status,
        amount_cents = EXCLUDED.amount_cents,
        currency = EXCLUDED.currency,
        billing_interval = COALESCE(EXCLUDED.billing_interval, subscriptions.billing_interval),
        interval_count = COALESCE(EXCLUDED.interval_count, subscriptions.interval_count),
        start_date = COALESCE(EXCLUDED.start_date, subscriptions.start_date),
        reminder_sent = CASE
          WHEN EXCLUDED.end_date IS NOT NULL AND (subscriptions.end_date IS NULL OR EXCLUDED.end_date > subscriptions.end_date) THEN false
          ELSE subscriptions.reminder_sent
        END,
        end_date = COALESCE(EXCLUDED.end_date, subscriptions.end_date),
        cancel_at_period_end = EXCLUDED.cancel_at_period_end,
        updated_at = NOW()
      RETURNING *`,
      [
        userId,
        stripeSubscriptionId,
        stripePriceId || null,
        plan || 'Subscription',
        mappedStatus,
        stripeStatus || mappedStatus,
        amountCents || 0,
        (currency || 'usd').toLowerCase(),
        billingInterval || null,
        intervalCount || 1,
        startDate || null,
        endDate || null,
        Boolean(cancelAtPeriodEnd),
      ],
    );
    return rows[0];
  } catch (err) {
    if (err.code === '23505' && stripeSubscriptionId) {
      const existing = await findSubscriptionByStripeId(stripeSubscriptionId, db);
      if (existing) return existing;
    }
    throw err;
  }
}

export async function listExpiringSubscriptions({ startIso, endIso }, db = pool) {
  const { rows } = await db.query(
    `SELECT s.*, u.email, u.name
     FROM subscriptions s
     JOIN users u ON u.id = s.user_id
     WHERE s.status IN ('active', 'incomplete')
       AND s.reminder_sent = false
       AND s.end_date IS NOT NULL
       AND s.end_date BETWEEN $1 AND $2
     ORDER BY s.end_date ASC`,
    [startIso, endIso],
  );
  return rows;
}

export async function markReminderSent(subscriptionId, db = pool) {
  const { rowCount } = await db.query(
    `UPDATE subscriptions SET reminder_sent = true, updated_at = NOW() WHERE id = $1`,
    [subscriptionId],
  );
  return rowCount > 0;
}

export async function expireSubscriptions(cutoffIso, db = pool) {
  const { rows } = await db.query(
    `UPDATE subscriptions
     SET status = 'expired', updated_at = NOW()
     WHERE status IN ('active', 'past_due')
       AND end_date IS NOT NULL
       AND end_date < $1
     RETURNING *`,
    [cutoffIso],
  );
  return rows;
}
