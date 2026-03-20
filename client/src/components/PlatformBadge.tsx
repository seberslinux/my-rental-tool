interface PlatformBadgeProps {
  platform: string;
}

export default function PlatformBadge({ platform }: PlatformBadgeProps) {
  const p = platform?.toLowerCase() || '';
  if (p.includes('airbnb')) return <span className="badge badge-airbnb">Airbnb</span>;
  if (p.includes('booking')) return <span className="badge badge-booking">Booking</span>;
  if (p.includes('blocked') || p.includes('block')) return <span className="badge badge-blocked">Blocked</span>;
  return <span className="badge badge-direct">{platform || 'Direct'}</span>;
}
