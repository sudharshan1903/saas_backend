import './stdio-guard.js';

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { env } from '../config/env.js';
import { getStatsSummary, getRevenueTotal } from '../services/stats.service.js';
import { getExpiringSubscriptions } from '../services/subscription.service.js';
import { maskEmail } from '../utils/mask.js';
import { closeDb } from '../config/db.js';
import { closeRedis } from '../config/redis.js';

const server = new McpServer({
  name: 'saas-analytics-mcp-server',
  version: '1.0.0',
});

// Tool 1: Get Active Subscribers
server.tool(
  'get_active_subscribers',
  'Retrieve the count of current active paying subscribers on the platform.',
  {
    currency: z.string().length(3).default(env.DEFAULT_CURRENCY).describe('Three-letter ISO currency code'),
  },
  async ({ currency }) => {
    try {
      const stats = await getStatsSummary(currency, { useCache: true });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                activeSubscribers: stats.activeSubscribers,
                currency: stats.currency,
                generatedAt: stats.generatedAt,
                cached: stats.cached,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Error fetching active subscribers: ${err.message}` }],
      };
    }
  },
);

// Tool 2: Get Revenue Total
server.tool(
  'get_revenue_total',
  'Retrieve total simulated payment revenue for a specific currency or across all currencies.',
  {
    currency: z.string().length(3).default(env.DEFAULT_CURRENCY).describe('Three-letter ISO currency code (e.g. usd)'),
  },
  async ({ currency }) => {
    try {
      const revenue = await getRevenueTotal(currency);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(revenue, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Error fetching revenue totals: ${err.message}` }],
      };
    }
  },
);

// Tool 3: Get Platform Summary
server.tool(
  'get_platform_summary',
  'Retrieve comprehensive platform metrics including MRR, total revenue, active subscriber count, and upcoming expirations.',
  {
    currency: z.string().length(3).default(env.DEFAULT_CURRENCY).describe('Three-letter ISO currency code'),
  },
  async ({ currency }) => {
    try {
      const summary = await getStatsSummary(currency, { useCache: true });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(summary, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Error fetching platform summary: ${err.message}` }],
      };
    }
  },
);

// Tool 4: Get Expiring Subscriptions (with masked emails)
server.tool(
  'get_expiring_subscriptions',
  'List active subscriptions that are set to expire within the next N days. All customer emails are masked for privacy.',
  {
    daysAhead: z.number().int().min(1).max(30).default(7).describe('Number of days to look ahead for expiration (1 to 30)'),
  },
  async ({ daysAhead }) => {
    try {
      const now = new Date();
      const end = new Date(now.getTime() + daysAhead * 24 * 3600 * 1000);

      const rows = await getExpiringSubscriptions({
        startIso: now.toISOString(),
        endIso: end.toISOString(),
      });

      const sanitizedRows = rows.map((sub) => ({
        subscriptionId: sub.id,
        stripeSubscriptionId: sub.stripe_subscription_id,
        plan: sub.plan,
        amountCents: sub.amount_cents,
        currency: sub.currency,
        endDate: sub.end_date,
        maskedEmail: maskEmail(sub.email),
        customerName: sub.name || 'Customer',
        reminderSent: sub.reminder_sent,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
      }));

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                daysAhead,
                count: sanitizedRows.length,
                expiringSubscriptions: sanitizedRows,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Error fetching expiring subscriptions: ${err.message}` }],
      };
    }
  },
);

async function main() {
  const transport = new StdioServerTransport();

  const shutdown = async (signal) => {
    console.error(`[MCP] Shutting down server (${signal})...`);
    try {
      await Promise.all([closeDb(), closeRedis()]);
      console.error('[MCP] Resources closed successfully');
      process.exit(0);
    } catch (err) {
      console.error('[MCP] Shutdown error:', err);
      process.exit(1);
    }
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.stdin.on('close', () => shutdown('stdin_close'));

  await server.connect(transport);
  console.error('✅ SaaS Platform MCP Server running on stdio');
}

const currentFile = fileURLToPath(import.meta.url);
const executedFile = process.argv[1] ? path.resolve(process.argv[1]) : '';

if (executedFile === currentFile || pathToFileURL(executedFile).href === import.meta.url) {
  main().catch((err) => {
    console.error('❌ MCP Server failed to start:', err);
    process.exit(1);
  });
}
