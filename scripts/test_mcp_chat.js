import readline from 'node:readline';
import { getStatsSummary, getRevenueTotal } from '../src/services/stats.service.js';
import { getExpiringSubscriptions } from '../src/services/subscription.service.js';
import { pool } from '../src/config/db.js';
import { maskEmail } from '../src/utils/mask.js';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

console.log('\n======================================================');
console.log(' SaaS Platform Interactive MCP Query Assistant');
console.log('Ask questions about subscribers, revenue, or pending payments.');
console.log('Type "exit" or "quit" to stop.');
console.log('======================================================\n');

async function handleQuestion(question) {
  const q = question.toLowerCase().trim();

  if (q.includes('subscriber') || q.includes('users') || q.includes('how many user') || q.includes('active')) {
    const stats = await getStatsSummary('usd', { useCache: true });
    console.log('\n [MCP Tool: get_active_subscribers]');
    console.log(` Total Active Paying Subscribers: ${stats.activeSubscribers}`);
    console.log(` Monthly Recurring Revenue (MRR): $${(stats.monthlyRecurringRevenueCents / 100).toFixed(2)}`);
    console.log(` Currency: ${stats.currency.toUpperCase()}`);
    return;
  }

  if (q.includes('pending') || q.includes('failed') || q.includes('expiring') || q.includes('past due')) {
    const rows = await getExpiringSubscriptions({
      startIso: new Date().toISOString(),
      endIso: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
    });

    const pendingRes = await pool.query("SELECT COUNT(*) FROM payments WHERE status = 'failed' OR status = 'pending';");
    const pendingCount = pendingRes.rows[0].count;

    console.log('\n [MCP Tool: get_expiring_subscriptions]');
    console.log(` Pending / Failed Payments Count: ${pendingCount}`);
    console.log(` Subscriptions Expiring within 30 days: ${rows.length}`);
    if (rows.length > 0) {
      rows.forEach((sub, i) => {
        console.log(`   ${i + 1}. Plan: ${sub.plan} | Customer: ${maskEmail(sub.email)} | Status: ${sub.status || 'active'} | End Date: ${sub.end_date}`);
      });
    }
    return;
  }

  if (q.includes('revenue') || q.includes('total') || q.includes('earnings') || q.includes('money')) {
    const rev = await getRevenueTotal('usd');
    console.log('\n [MCP Tool: get_revenue_total]');
    console.log(` Total Revenue: ${rev.totalRevenueFormatted}`);
    console.log(` Revenue in Cents: ${rev.totalRevenueCents}`);
    return;
  }

  // Default summary
  const summary = await getStatsSummary('usd', { useCache: true });
  console.log('\n [MCP Platform Summary]');
  console.log(JSON.stringify(summary, null, 2));
}

function promptUser() {
  rl.question('\n Ask a question: ', async (answer) => {
    if (answer.toLowerCase() === 'exit' || answer.toLowerCase() === 'quit') {
      console.log('Goodbye!');
      rl.close();
      process.exit(0);
    }
    try {
      await handleQuestion(answer);
    } catch (err) {
      console.error('Error:', err.message);
    }
    promptUser();
  });
}

promptUser();
