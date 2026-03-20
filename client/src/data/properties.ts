export interface Property {
  id: number;
  name: string;
  base: number;
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

export const TODAY = D(2026, 3, 18);
export const HOLIDAY = D(2026, 3, 21);
export const CLEANER_TOGGLE = true;

export const properties: Property[] = [
{ id: 1, name: 'Camps Bay Villa', base: 2100 },
{ id: 2, name: 'Green Point Apt', base: 1450 },
{ id: 3, name: 'Sea Point Studio', base: 980 }];


export const bookings: Booking[] = [
// Camps Bay Villa
{
  id: 'b1',
  propId: 1,
  type: 'airbnb',
  name: 'Laura Reiter',
  checkIn: D(2026, 3, 2),
  checkOut: D(2026, 3, 6),
  total: 8400
},
{
  id: 'b2',
  propId: 1,
  type: 'bcom',
  name: 'Andi Rivera',
  checkIn: D(2026, 3, 7),
  checkOut: D(2026, 3, 11),
  total: 8400
},
{
  id: 'b3',
  propId: 1,
  type: 'blocked',
  name: 'Blocked',
  checkIn: D(2026, 3, 11),
  checkOut: D(2026, 3, 13),
  total: 0
},
{
  id: 'b4',
  propId: 1,
  type: 'airbnb',
  name: 'Felix Geiger',
  checkIn: D(2026, 3, 15),
  checkOut: D(2026, 3, 19),
  total: 8400
},
{
  id: 'b5',
  propId: 1,
  type: 'blocked',
  name: 'Maintenance',
  checkIn: D(2026, 3, 19),
  checkOut: D(2026, 3, 21),
  total: 0
},
{
  id: 'b6',
  propId: 1,
  type: 'airbnb',
  name: 'Megan Hall',
  checkIn: D(2026, 3, 21),
  checkOut: D(2026, 3, 26),
  total: 12600
},
{
  id: 'b7',
  propId: 1,
  type: 'bcom',
  name: 'Claudia Franz',
  checkIn: D(2026, 3, 27),
  checkOut: D(2026, 4, 1),
  total: 10500
},

// Green Point Apt
{
  id: 'b8',
  propId: 2,
  type: 'bcom',
  name: 'Paul Werner',
  checkIn: D(2026, 3, 1),
  checkOut: D(2026, 3, 5),
  total: 5800
},
{
  id: 'b9',
  propId: 2,
  type: 'airbnb',
  name: 'Sarah Chen',
  checkIn: D(2026, 3, 6),
  checkOut: D(2026, 3, 10),
  total: 5800
},
{
  id: 'b10',
  propId: 2,
  type: 'bcom',
  name: 'Tom Baker',
  checkIn: D(2026, 3, 10),
  checkOut: D(2026, 3, 14),
  total: 5800
},
{
  id: 'b11',
  propId: 2,
  type: 'direct',
  name: 'Maria Lopez',
  checkIn: D(2026, 3, 16),
  checkOut: D(2026, 3, 20),
  total: 5800
},
{
  id: 'b12',
  propId: 2,
  type: 'blocked',
  name: 'Blocked',
  checkIn: D(2026, 3, 20),
  checkOut: D(2026, 3, 22),
  total: 0
},
{
  id: 'b13',
  propId: 2,
  type: 'airbnb',
  name: 'Kai Sieben',
  checkIn: D(2026, 3, 23),
  checkOut: D(2026, 3, 28),
  total: 8700
},
{
  id: 'b14',
  propId: 2,
  type: 'bcom',
  name: 'Nina Petrov',
  checkIn: D(2026, 3, 29),
  checkOut: D(2026, 4, 2),
  total: 5800
},

// Sea Point Studio
{
  id: 'b15',
  propId: 3,
  type: 'direct',
  name: 'P. Blake',
  checkIn: D(2026, 3, 1),
  checkOut: D(2026, 3, 4),
  total: 2940
},
{
  id: 'b16',
  propId: 3,
  type: 'airbnb',
  name: 'M. Torres',
  checkIn: D(2026, 3, 5),
  checkOut: D(2026, 3, 9),
  total: 3920
},
{
  id: 'b17',
  propId: 3,
  type: 'bcom',
  name: 'P. Schwarz',
  checkIn: D(2026, 3, 10),
  checkOut: D(2026, 3, 14),
  total: 3920
},
{
  id: 'b18',
  propId: 3,
  type: 'blocked',
  name: 'Deep clean',
  checkIn: D(2026, 3, 14),
  checkOut: D(2026, 3, 16),
  total: 0
},
{
  id: 'b19',
  propId: 3,
  type: 'direct',
  name: 'P. Dupont',
  checkIn: D(2026, 3, 18),
  checkOut: D(2026, 3, 22),
  total: 3920
},
{
  id: 'b20',
  propId: 3,
  type: 'airbnb',
  name: 'M. Watson',
  checkIn: D(2026, 3, 23),
  checkOut: D(2026, 3, 27),
  total: 3920
},
{
  id: 'b21',
  propId: 3,
  type: 'bcom',
  name: 'K. Yamada',
  checkIn: D(2026, 3, 28),
  checkOut: D(2026, 4, 1),
  total: 3920
}];


export const cleaners: Record<number, number[]> = {
  1: [6, 13, 19, 26],
  2: [5, 14, 22, 28],
  3: [4, 9, 22, 27]
};

// Helper functions
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