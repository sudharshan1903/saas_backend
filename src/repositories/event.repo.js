import { pool } from '../config/db.js';

export async function hasProcessedEvent(stripeEventId, db = pool) {
  if (!stripeEventId) return false;
  const { rows } = await db.query(
    'SELECT 1 FROM processed_events WHERE stripe_event_id = $1 LIMIT 1',
    [stripeEventId],
  );
  return rows.length > 0;
}

export async function insertProcessedEvent(stripeEventId, eventType, db = pool) {
  const { rowCount } = await db.query(
    `INSERT INTO processed_events (stripe_event_id, event_type)
     VALUES ($1, $2)
     ON CONFLICT (stripe_event_id) DO NOTHING`,
    [stripeEventId, eventType],
  );
  return rowCount > 0;
}
