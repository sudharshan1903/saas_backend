import { query } from '../config/db.js';

export async function insertInvoiceEmailOutbox({ referenceId, payload }, client) {
  const runQuery = client ? client.query.bind(client) : query;
  await runQuery(
    `INSERT INTO notification_outbox (event_type, reference_id, payload)
     VALUES ('invoice_email', $1, $2::jsonb)
     ON CONFLICT (event_type, reference_id) DO NOTHING`,
    [referenceId, JSON.stringify(payload)],
  );
}

export async function listPendingOutbox(client, limit = 100) {
  const { rows } = await client.query(
    `SELECT id, event_type, reference_id, payload
     FROM notification_outbox
     WHERE status = 'pending'
     ORDER BY created_at
     LIMIT $1
     FOR UPDATE SKIP LOCKED
     `,
    [limit],
  );
  return rows;
}

export async function markOutboxQueued(id, client) {
  await client.query(
    `UPDATE notification_outbox SET status = 'queued', updated_at = NOW() WHERE id = $1`,
    [id],
  );
}

export async function markOutboxPending(id, client) {
  const runQuery = client ? client.query.bind(client) : query;
  await runQuery(
    `UPDATE notification_outbox SET status = 'pending', updated_at = NOW() WHERE id = $1 AND status != 'sent'`,
    [id],
  );
}

export async function markOutboxSent(id, client) {
  const runQuery = client ? client.query.bind(client) : query;
  await runQuery(
    `UPDATE notification_outbox SET status = 'sent', updated_at = NOW() WHERE id = $1`,
    [id],
  );
}
