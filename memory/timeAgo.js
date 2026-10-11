/** "just now", "3 hours ago", "2 days ago" - for shared memories shown to the model. */
export function describeAge(ts, now = Date.now()) {
  const mins = Math.max(0, Math.round((now - ts) / 60000));
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
