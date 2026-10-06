import { getStatsSummary } from '../services/stats.service.js';
import { env } from '../config/env.js';

export async function getStats(req, res) {
  const currency = req.query.currency || env.DEFAULT_CURRENCY;
  const useCache = req.query.nocache !== 'true';

  const stats = await getStatsSummary(currency, { useCache });

  res.status(200).json({
    success: true,
    data: stats,
  });
}
