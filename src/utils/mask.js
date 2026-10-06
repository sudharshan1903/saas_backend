export function maskEmail(email) {
  if (!email || typeof email !== 'string') return '***@***.***';
  const parts = email.split('@');
  if (parts.length !== 2) return '***@***.***';
  const [local, domain] = parts;
  if (!local) return `***@${domain}`;
  const firstChar = local.charAt(0);
  return `${firstChar}***@${domain}`;
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}
