CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email CITEXT NOT NULL UNIQUE,
  name TEXT,
  stripe_customer_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_subscription_id TEXT UNIQUE,
  stripe_price_id TEXT,
  plan TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'past_due', 'canceled', 'expired', 'incomplete')),
  stripe_status TEXT,
  amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'usd',
  billing_interval TEXT CHECK (billing_interval IN ('day', 'week', 'month', 'year')),
  interval_count INTEGER NOT NULL DEFAULT 1 CHECK (interval_count >= 1),
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ,
  reminder_sent BOOLEAN NOT NULL DEFAULT FALSE,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  stripe_invoice_id TEXT UNIQUE,
  stripe_payment_intent_id TEXT,
  amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'usd',
  status TEXT NOT NULL CHECK (status IN ('paid', 'failed')),
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID UNIQUE REFERENCES payments(id) ON DELETE SET NULL,
  subscription_id UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
  invoice_number TEXT NOT NULL UNIQUE,
  file_path TEXT,
  amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  email_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE SEQUENCE IF NOT EXISTS invoice_number_seq START WITH 1 INCREMENT BY 1;

CREATE TABLE IF NOT EXISTS processed_events (
  stripe_event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_status_end_date ON subscriptions(status, end_date);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_payments_subscription_id ON payments(subscription_id);
CREATE INDEX IF NOT EXISTS idx_payments_status_created_at ON payments(status, created_at);

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_subscriptions_updated_at ON subscriptions;
CREATE TRIGGER trg_subscriptions_updated_at
BEFORE UPDATE ON subscriptions
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Optional demo seed example query:
-- WITH new_user AS (
--   INSERT INTO users (email, name, stripe_customer_id)
--   VALUES ('demo@example.com', 'Demo User', 'cus_demo_seed_1')
--   ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name RETURNING id
-- ), new_sub AS (
--   INSERT INTO subscriptions (user_id, stripe_subscription_id, plan, status, stripe_status, amount_cents, currency, billing_interval, interval_count, start_date, end_date)
--   SELECT id, 'sub_demo_seed_1', 'Pro Plan', 'active', 'active', 2900, 'usd', 'month', 1, NOW(), NOW() + INTERVAL '5 minutes'
--   FROM new_user
--   ON CONFLICT (stripe_subscription_id) DO UPDATE SET end_date = EXCLUDED.end_date RETURNING id
-- )
-- INSERT INTO payments (subscription_id, stripe_invoice_id, amount_cents, currency, status, paid_at)
-- SELECT id, 'in_demo_seed_1', 2900, 'usd', 'paid', NOW() FROM new_sub
-- ON CONFLICT (stripe_invoice_id) DO NOTHING;
