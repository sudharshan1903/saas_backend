import { pool } from '../config/db.js';

export async function findPaymentByStripeInvoiceId(stripeInvoiceId, db = pool) {
  if (!stripeInvoiceId) return null;
  const { rows } = await db.query(
    'SELECT * FROM payments WHERE stripe_invoice_id = $1 LIMIT 1',
    [stripeInvoiceId],
  );
  return rows[0] || null;
}

export async function findPaymentById(id, db = pool) {
  const { rows } = await db.query(
    'SELECT * FROM payments WHERE id = $1 LIMIT 1',
    [id],
  );
  return rows[0] || null;
}

export async function findPaymentDetailsForInvoice(paymentId, db = pool) {
  const { rows } = await db.query(
    `SELECT p.*, s.plan, s.user_id, u.email as user_email, u.name as user_name
     FROM payments p
     JOIN subscriptions s ON s.id = p.subscription_id
     JOIN users u ON u.id = s.user_id
     WHERE p.id = $1 LIMIT 1`,
    [paymentId],
  );
  return rows[0] || null;
}

export async function upsertPayment({
  subscriptionId,
  stripeInvoiceId,
  stripePaymentIntentId,
  amountCents,
  currency,
  status,
  paidAt,
}, db = pool) {
  const normalizedStatus = status === 'failed' ? 'failed' : 'paid';

  const { rows } = await db.query(
    `INSERT INTO payments (
      subscription_id, stripe_invoice_id, stripe_payment_intent_id, amount_cents, currency, status, paid_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (stripe_invoice_id) DO UPDATE SET
      subscription_id = EXCLUDED.subscription_id,
      stripe_payment_intent_id = COALESCE(EXCLUDED.stripe_payment_intent_id, payments.stripe_payment_intent_id),
      amount_cents = EXCLUDED.amount_cents,
      currency = EXCLUDED.currency,
      status = CASE
        WHEN payments.status = 'paid' THEN 'paid'
        ELSE EXCLUDED.status
      END,
      paid_at = COALESCE(EXCLUDED.paid_at, payments.paid_at)
    RETURNING *`,
    [
      subscriptionId,
      stripeInvoiceId,
      stripePaymentIntentId || null,
      amountCents || 0,
      (currency || 'usd').toLowerCase(),
      normalizedStatus,
      paidAt || null,
    ],
  );
  return rows[0];
}

export async function listUnsentPaidPayments({ olderThanMinutes = 2, youngerThanHours = 48 }, db = pool) {
  const { rows } = await db.query(
    `SELECT p.id as payment_id, p.created_at
     FROM payments p
     LEFT JOIN invoices i ON i.payment_id = p.id
     WHERE p.status = 'paid'
       AND (i.email_sent_at IS NULL OR i.id IS NULL)
       AND p.created_at < NOW() - ($1::text || ' minutes')::interval
       AND p.created_at > NOW() - ($2::text || ' hours')::interval
     ORDER BY p.created_at ASC
     LIMIT 100`,
    [String(olderThanMinutes), String(youngerThanHours)],
  );
  return rows;
}
