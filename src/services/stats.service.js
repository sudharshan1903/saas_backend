import { pool } from '../config/db.js';
import { env } from '../config/env.js';
import { cacheService } from './cache.service.js';
import { centsToCurrency } from '../utils/money.js';
import { AppError } from '../utils/AppError.js';

const inFlightStatsPromises = new Map();

export async function getStatsSummary(currency = env.DEFAULT_CURRENCY, { useCache = true } = {}) {
  const normalizedCurrency = String(currency).toLowerCase();
  if (!/^[a-z]{3}$/.test(normalizedCurrency)) {
    throw new AppError('INVALID_CURRENCY', 'Currency must be a 3-letter ISO code', 400);
  }

  const cacheKey = `stats:summary:${normalizedCurrency}`;

  if (useCache) {
    const cached = await cacheService.get(cacheKey);
    if (cached) {
      return { ...cached, cached: true };
    }
  }

  // Deduplicate in-flight DB queries for the same currency
  if (inFlightStatsPromises.has(normalizedCurrency)) {
    return inFlightStatsPromises.get(normalizedCurrency);
  }

  const fetchPromise = (async () => {
    try {
      const reminderDays = env.REMINDER_DAYS_BEFORE;

      const statsQuery = `
        SELECT
          COUNT(*) FILTER (WHERE s.status IN ('active')) AS active_subscribers,
          COALESCE(SUM(
            CASE
              WHEN s.status != 'active' THEN 0
              WHEN s.billing_interval = 'year' THEN s.amount_cents::numeric / (12 * GREATEST(s.interval_count, 1))
              WHEN s.billing_interval = 'week' THEN (s.amount_cents::numeric * 52) / (12 * GREATEST(s.interval_count, 1))
              WHEN s.billing_interval = 'day' THEN (s.amount_cents::numeric * 365) / (12 * GREATEST(s.interval_count, 1))
              WHEN s.billing_interval = 'month' THEN s.amount_cents::numeric / GREATEST(s.interval_count, 1)
              ELSE s.amount_cents
            END
          ), 0)::bigint AS mrr_cents,
          (
            SELECT COALESCE(SUM(p.amount_cents), 0)
            FROM payments p
            WHERE p.status = 'paid' AND LOWER(p.currency) = $1
          )::bigint AS total_revenue_cents,
          COUNT(*) FILTER (
            WHERE s.status IN ('active')
              AND s.end_date IS NOT NULL
              AND s.end_date BETWEEN NOW() AND NOW() + ($2::numeric * INTERVAL '1 day')
          ) AS expiring_soon
        FROM subscriptions s
        WHERE LOWER(s.currency) = $1
      `;

      const currencyBreakdownQuery = `
        SELECT LOWER(currency) as currency, COALESCE(SUM(amount_cents), 0)::bigint as total_cents
        FROM payments
        WHERE status = 'paid'
        GROUP BY LOWER(currency)
      `;

      const [statsRes, breakdownRes] = await Promise.all([
        pool.query(statsQuery, [normalizedCurrency, reminderDays]),
        pool.query(currencyBreakdownQuery),
      ]);

      const row = statsRes.rows[0] || {};
      const activeSubscribers = Number(row.active_subscribers || 0);
      const mrrCents = Number(row.mrr_cents || 0);
      const totalRevenueCents = Number(row.total_revenue_cents || 0);
      const expiringSoon = Number(row.expiring_soon || 0);

      const revenueByCurrency = breakdownRes.rows.reduce((acc, r) => {
        acc[r.currency] = Number(r.total_cents || 0);
        return acc;
      }, {});

      const result = {
        activeSubscribers,
        expiringSoon,
        currency: normalizedCurrency,
        totalRevenueCents,
        totalRevenueFormatted: centsToCurrency(totalRevenueCents, normalizedCurrency),
        monthlyRecurringRevenueCents: mrrCents,
        revenueByCurrency,
        generatedAt: new Date().toISOString(),
        cached: false,
      };

      if (useCache) {
        await cacheService.set(cacheKey, result, env.STATS_CACHE_TTL_SECONDS);
      }

      return result;
    } finally {
      inFlightStatsPromises.delete(normalizedCurrency);
    }
  })();

  inFlightStatsPromises.set(normalizedCurrency, fetchPromise);
  return fetchPromise;
}

export async function getRevenueTotal(currency = env.DEFAULT_CURRENCY) {
  const stats = await getStatsSummary(currency, { useCache: true });
  return {
    currency: stats.currency,
    totalRevenueCents: stats.totalRevenueCents,
    totalRevenueFormatted: stats.totalRevenueFormatted,
    revenueByCurrency: stats.revenueByCurrency,
    generatedAt: stats.generatedAt,
  };
}
