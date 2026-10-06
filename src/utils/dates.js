export function timestampToIso(timestamp) {
  if (timestamp === null || timestamp === undefined) return null;
  const num = Number(timestamp);
  if (!Number.isFinite(num)) return null;
  return new Date(num * 1000).toISOString();
}

export function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function isPast(date) {
  if (!date) return false;
  return new Date(date).getTime() < Date.now();
}
