export function centsToCurrency(amountCents = 0, currency = 'usd') {
  const value = (Number(amountCents) || 0) / 100;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(value);
  } catch {
    return `$${value.toFixed(2)}`;
  }
}
