export function mapStripeStatus(stripeStatus) {
  const status = String(stripeStatus || '').toLowerCase();
  switch (status) {
    case 'active':
    case 'trialing':
      return 'active';
    case 'past_due':
    case 'unpaid':
    case 'paused':
      return 'past_due';
    case 'canceled':
    case 'incomplete_expired':
      return 'canceled';
    case 'incomplete':
    default:
      return 'incomplete';
  }
}

export function extractPeriodEnd(subscription) {
  if (!subscription) return null;
  const itemPeriodEnd = subscription.items?.data?.[0]?.current_period_end;
  if (Number.isFinite(itemPeriodEnd)) return itemPeriodEnd;
  const subPeriodEnd = subscription.current_period_end;
  if (Number.isFinite(subPeriodEnd)) return subPeriodEnd;
  return null;
}

export function extractPeriodStart(subscription) {
  if (!subscription) return null;
  const itemPeriodStart = subscription.items?.data?.[0]?.current_period_start;
  if (Number.isFinite(itemPeriodStart)) return itemPeriodStart;
  const subPeriodStart = subscription.current_period_start;
  if (Number.isFinite(subPeriodStart)) return subPeriodStart;
  return null;
}

export function extractInvoiceSubscriptionId(invoice) {
  if (!invoice) return null;
  const sub = invoice.subscription
    || invoice.parent?.subscription_details?.subscription
    || invoice.lines?.data?.[0]?.parent?.subscription_item_details?.subscription
    || invoice.lines?.data?.[0]?.subscription;
  if (typeof sub === 'string') return sub;
  if (sub && typeof sub === 'object' && typeof sub.id === 'string') return sub.id;
  return null;
}

export function extractCustomerId(val) {
  if (!val) return null;
  if (typeof val === 'string') return val;
  if (typeof val === 'object' && typeof val.id === 'string') return val.id;
  return null;
}

export function extractAmountPaidCents(invoice) {
  if (!invoice) return 0;
  if (invoice.amount_paid !== undefined && invoice.amount_paid !== null) {
    return Number(invoice.amount_paid);
  }
  if (invoice.total !== undefined && invoice.total !== null) {
    return Number(invoice.total);
  }
  return 0;
}
