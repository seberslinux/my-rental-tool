// Relative time formatter, e.g. "just now", "5m ago", "3h ago", "2d ago".
export function relativeTime(dateStr: string | null | undefined): string {
  if (!dateStr) return 'never';
  const then = new Date(dateStr).getTime();
  const diffMs = Date.now() - then;
  if (isNaN(diffMs)) return 'never';
  if (diffMs < 0) return 'just now';
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
