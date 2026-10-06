import { pool } from '../config/db.js';

export async function getNextInvoiceNumber(db = pool) {
  const year = new Date().getUTCFullYear();
  const { rows } = await db.query("SELECT nextval('invoice_number_seq') AS num");
  const numStr = String(rows[0].num).padStart(6, '0');
  return `INV-${year}-${numStr}`;
}

export async function findInvoiceByPaymentId(paymentId, db = pool) {
  if (!paymentId) return null;
  const { rows } = await db.query(
    'SELECT * FROM invoices WHERE payment_id = $1 LIMIT 1',
    [paymentId],
  );
  return rows[0] || null;
}

export async function findInvoiceById(id, db = pool) {
  const { rows } = await db.query(
    'SELECT * FROM invoices WHERE id = $1 LIMIT 1',
    [id],
  );
  return rows[0] || null;
}

export async function createInvoiceRecord({ paymentId, subscriptionId, invoiceNumber, filePath, amountCents }, db = pool) {
  const { rows } = await db.query(
    `INSERT INTO invoices (payment_id, subscription_id, invoice_number, file_path, amount_cents)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (payment_id) DO NOTHING
     RETURNING *`,
    [paymentId, subscriptionId, invoiceNumber, filePath, amountCents || 0],
  );

  if (rows[0]) return rows[0];

  return findInvoiceByPaymentId(paymentId, db);
}

export async function markInvoiceEmailSent(invoiceId, db = pool) {
  const { rowCount } = await db.query(
    'UPDATE invoices SET email_sent_at = NOW() WHERE id = $1 AND email_sent_at IS NULL',
    [invoiceId],
  );
  return rowCount > 0;
}
