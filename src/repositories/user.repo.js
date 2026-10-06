import { pool } from '../config/db.js';

export async function findUserByEmail(email, db = pool) {
  const { rows } = await db.query(
    'SELECT * FROM users WHERE email = $1 LIMIT 1',
    [email],
  );
  return rows[0] || null;
}

export async function findUserByStripeCustomerId(stripeCustomerId, db = pool) {
  if (!stripeCustomerId) return null;
  const { rows } = await db.query(
    'SELECT * FROM users WHERE stripe_customer_id = $1 LIMIT 1',
    [stripeCustomerId],
  );
  return rows[0] || null;
}

export async function upsertUser({ email, name, stripeCustomerId }, db = pool) {
  const normalizedEmail = String(email).trim().toLowerCase();

  if (stripeCustomerId) {
    const existingByCustomer = await findUserByStripeCustomerId(stripeCustomerId, db);
    if (existingByCustomer) {
      const { rows } = await db.query(
        `UPDATE users SET name = COALESCE($1, name), email = COALESCE($2, email), updated_at = NOW()
         WHERE id = $3 RETURNING *`,
        [name || null, normalizedEmail || null, existingByCustomer.id],
      );
      return rows[0];
    }
  }

  const existingByEmail = await findUserByEmail(normalizedEmail, db);
  if (existingByEmail) {
    const { rows } = await db.query(
      `UPDATE users SET name = COALESCE($1, name), stripe_customer_id = COALESCE($2, stripe_customer_id), updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [name || null, stripeCustomerId || null, existingByEmail.id],
    );
    return rows[0];
  }

  try {
    const { rows } = await db.query(
      `INSERT INTO users (email, name, stripe_customer_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE SET
         name = COALESCE(EXCLUDED.name, users.name),
         stripe_customer_id = COALESCE(EXCLUDED.stripe_customer_id, users.stripe_customer_id),
         updated_at = NOW()
       RETURNING *`,
      [normalizedEmail, name || 'Customer', stripeCustomerId || null],
    );
    return rows[0];
  } catch (err) {
    if (err.code === '23505') {
      const existing = (stripeCustomerId ? await findUserByStripeCustomerId(stripeCustomerId, db) : null) || await findUserByEmail(normalizedEmail, db);
      if (existing) return existing;
    }
    throw err;
  }
}
