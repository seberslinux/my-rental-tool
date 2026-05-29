export interface Property {
  id: number;
  name: string;
  base: number;
  checkInTime: string; // e.g. '15:00'
}

export type ChannelType = 'airbnb' | 'bcom' | 'direct' | 'blocked';

export interface Booking {
  id: string;
  propId: number;
  type: ChannelType;
  name: string;
  checkIn: Date;
  checkOut: Date;
  total: number;
}

export const D = (year: number, month: number, day: number) =>
new Date(year, month - 1, day);

const now = new Date();
export const TODAY = D(now.getFullYear(), now.getMonth() + 1, now.getDate());
export const HOLIDAY = D(2026, 3, 21);
export const CLEANER_TOGGLE = true;

// Live data — populated by loadCalendarData(), read by all components
export let properties: Property[] = [];
export let bookings: Booking[] = [];
export let cleaners: Record<number, number[]> = {};

// Map API platform string → ChannelType
function mapPlatform(platform: string): ChannelType {
  const p = (platform || '').toLowerCase();
  // Check 'direct'/'block' first: Smoobu names direct bookings "Direct booking",
  // which contains the substring "booking" and would otherwise match as bcom.
  if (p.includes('direct')) return 'direct';
  if (p.includes('blocked') || p.includes('block') || p.includes('maintenance')) return 'blocked';
  if (p.includes('airbnb')) return 'airbnb';
  if (p.includes('booking') || p.includes('bcom')) return 'bcom';
  return 'direct';
}

// Fetch from real API — call once after auth, before rendering calendar
export async function loadCalendarData(): Promise<void> {
  const [propsRes, bookingsRes, statsRes] = await Promise.all([
    fetch('/api/properties', { credentials: 'same-origin' }),
    fetch('/api/bookings', { credentials: 'same-origin' }),
    fetch('/api/dashboard/stats', { credentials: 'same-origin' }),
  ]);

  if (propsRes.ok) {
    const propsData: any[] = await propsRes.json();
    properties = propsData.map((p) => ({
      id: p.id,
      name: p.name,
      base: p.base_price || 0,
      checkInTime: p.check_in_time || '15:00',
    }));
  }

  if (bookingsRes.ok) {
    const bData = await bookingsRes.json();
    const bArray: any[] = (bData.bookings || bData).filter((b: any) => b.status !== 'cancelled');
    bookings = bArray.map((b) => ({
      id: String(b.id),
      propId: b.property_id,
      type: mapPlatform(b.platform),
      name: b.guest_name || 'Guest',
      checkIn: new Date(b.check_in + 'T00:00:00'),
      checkOut: new Date(b.check_out + 'T00:00:00'),
      total: b.total_price || 0,
    }));
  }

  // Build cleaners map from pending cleaning jobs
  if (statsRes.ok) {
    const stats = await statsRes.json();
    const jobs: any[] = stats.pending_cleaning_jobs || [];
    const map: Record<number, number[]> = {};
    jobs.forEach((j) => {
      const propId = j.property_id;
      const day = new Date(j.cleaning_date + 'T00:00:00').getDate();
      if (!map[propId]) map[propId] = [];
      if (!map[propId].includes(day)) map[propId].push(day);
    });
    cleaners = map;
  }
}

// Helper functions (unchanged — they read from the module-level arrays above)
export function getRate(propId: number, date: Date): number {
  const prop = properties.find((p) => p.id === propId);
  if (!prop) return 0;
  const dayOfWeek = date.getDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  return isWeekend ? Math.round(prop.base * 1.3) : prop.base;
}

export function formatRate(rate: number): string {
  return rate >= 1000 ? `R ${(rate / 1000).toFixed(1)}K` : `R ${rate}`;
}

export function formatTotal(amount: number): string {
  if (!amount) return '';
  return amount >= 1000 ? `R${(amount / 1000).toFixed(1)}K` : `R${amount}`;
}

export function dateEqual(d1: Date, d2: Date): boolean {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate());
}

export function isDateInBooking(date: Date, booking: Booking): boolean {
  return date >= booking.checkIn && date < booking.checkOut;
}

export function isDateCovered(date: Date, propId: number): boolean {
  return bookings.some((b) => b.propId === propId && isDateInBooking(date, b));
}
