import { useState, useMemo } from 'react';
import { useApi } from '@/hooks/useApi';
import type { Booking, Property } from '@/types';
import PageHeader from '@/components/PageHeader';
import PlatformBadge from '@/components/PlatformBadge';
import { PageLoading, ErrorState } from '@/components/LoadingState';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

function platformColor(platform: string): string {
  const p = platform?.toLowerCase() || '';
  if (p.includes('airbnb')) return 'bg-pink-500';
  if (p.includes('booking')) return 'bg-blue-700';
  if (p.includes('blocked') || p.includes('block')) return 'bg-gray-400';
  return 'bg-green-500';
}

function platformColorLight(platform: string): string {
  const p = platform?.toLowerCase() || '';
  if (p.includes('airbnb')) return 'bg-pink-100 border-pink-300';
  if (p.includes('booking')) return 'bg-blue-100 border-blue-300';
  if (p.includes('blocked') || p.includes('block')) return 'bg-gray-100 border-gray-300';
  return 'bg-green-100 border-green-300';
}

export default function CalendarPage() {
  const [propertyFilter, setPropertyFilter] = useState<string>('all');
  const [channelFilter, setChannelFilter] = useState<string>('all');
  const [month, setMonth] = useState(() => new Date());
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);

  const { data: properties, loading: pLoading } = useApi<Property[]>('/api/properties');
  const { data: bookingRes, loading: bLoading, error } = useApi<{ bookings: Booking[] }>('/api/bookings');

  const bookings = useMemo(() => {
    if (!bookingRes) return [];
    let filtered = bookingRes.bookings;
    if (propertyFilter !== 'all') filtered = filtered.filter((b) => b.property_id === Number(propertyFilter));
    if (channelFilter !== 'all') filtered = filtered.filter((b) => b.platform?.toLowerCase().includes(channelFilter));
    return filtered;
  }, [bookingRes, propertyFilter, channelFilter]);

  if (pLoading || bLoading) return <PageLoading />;
  if (error) return <ErrorState message={error} />;

  const year = month.getFullYear();
  const m = month.getMonth();
  const daysInMonth = new Date(year, m + 1, 0).getDate();
  const firstDow = (new Date(year, m, 1).getDay() + 6) % 7; // Monday=0

  const prevMonth = () => setMonth(new Date(year, m - 1, 1));
  const nextMonth = () => setMonth(new Date(year, m + 1, 1));

  const getBookingsForDay = (day: number) => {
    const dateStr = `${year}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return bookings.filter(
      (b) => b.check_in <= dateStr && b.check_out > dateStr
    );
  };

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  return (
    <>
      <PageHeader title="Calendar">
        {properties && properties.length > 1 && (
          <select value={propertyFilter} onChange={(e) => setPropertyFilter(e.target.value)} className="input w-auto text-sm">
            <option value="all">All properties</option>
            {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        <select value={channelFilter} onChange={(e) => setChannelFilter(e.target.value)} className="input w-auto text-sm">
          <option value="all">All channels</option>
          <option value="airbnb">Airbnb</option>
          <option value="booking">Booking</option>
          <option value="direct">Direct</option>
          <option value="blocked">Blocked</option>
        </select>
      </PageHeader>

      <div className="p-4 md:p-6">
        {/* Month navigation */}
        <div className="flex items-center justify-between mb-4">
          <button onClick={prevMonth} className="btn-secondary p-2"><ChevronLeft size={18} /></button>
          <h2 className="text-lg font-semibold text-gray-900">{MONTHS[m]} {year}</h2>
          <button onClick={nextMonth} className="btn-secondary p-2"><ChevronRight size={18} /></button>
        </div>

        {/* Calendar grid */}
        <div className="card p-0 overflow-hidden">
          <div className="grid grid-cols-7">
            {DAYS.map((d) => (
              <div key={d} className="py-2 text-center text-xs font-semibold text-gray-500 uppercase border-b border-gray-200 bg-gray-50">
                {d}
              </div>
            ))}
            {/* Empty cells for offset */}
            {Array.from({ length: firstDow }).map((_, i) => (
              <div key={`empty-${i}`} className="min-h-[80px] border-b border-r border-gray-100 bg-gray-50/50" />
            ))}
            {/* Day cells */}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const dateStr = `${year}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              const dayBookings = getBookingsForDay(day);
              const isCurrentDay = dateStr === todayStr;
              return (
                <div
                  key={day}
                  className={`min-h-[80px] border-b border-r border-gray-100 p-1 ${
                    isCurrentDay ? 'bg-primary-50' : ''
                  }`}
                >
                  <span className={`text-xs font-medium ${
                    isCurrentDay ? 'bg-primary-600 text-white w-6 h-6 rounded-full flex items-center justify-center' : 'text-gray-600'
                  }`}>
                    {day}
                  </span>
                  <div className="mt-1 space-y-0.5">
                    {dayBookings.slice(0, 3).map((b) => (
                      <button
                        key={b.id}
                        onClick={() => setSelectedBooking(b)}
                        className={`w-full text-left text-[10px] px-1 py-0.5 rounded truncate border ${platformColorLight(b.platform)} hover:opacity-80 transition-opacity`}
                      >
                        {b.guest_name}
                      </button>
                    ))}
                    {dayBookings.length > 3 && (
                      <span className="text-[10px] text-gray-400 pl-1">+{dayBookings.length - 3} more</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Timeline view */}
        {properties && properties.length > 0 && (
          <div className="mt-6 card">
            <h2 className="text-base font-semibold text-gray-900 mb-4">Timeline</h2>
            <div className="overflow-x-auto">
              <div className="min-w-[800px]">
                {/* Day numbers header */}
                <div className="flex border-b border-gray-200 pb-2 mb-2">
                  <div className="w-32 flex-shrink-0" />
                  {Array.from({ length: daysInMonth }).map((_, i) => {
                    const dateStr = `${year}-${String(m + 1).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`;
                    return (
                      <div
                        key={i}
                        className={`flex-1 text-center text-[10px] font-medium ${
                          dateStr === todayStr ? 'text-primary-600 font-bold' : 'text-gray-500'
                        }`}
                      >
                        {i + 1}
                      </div>
                    );
                  })}
                </div>
                {/* Property rows */}
                {(propertyFilter === 'all' ? properties : properties.filter(p => p.id === Number(propertyFilter))).map((property) => {
                  const propBookings = bookings.filter((b) => b.property_id === property.id);
                  return (
                    <div key={property.id} className="flex items-center h-10 border-b border-gray-50">
                      <div className="w-32 flex-shrink-0 text-xs font-medium text-gray-700 truncate pr-2">
                        {property.name}
                      </div>
                      <div className="flex-1 flex relative h-6">
                        {Array.from({ length: daysInMonth }).map((_, i) => (
                          <div key={i} className="flex-1 border-r border-gray-50" />
                        ))}
                        {propBookings.map((b) => {
                          const start = new Date(b.check_in);
                          const end = new Date(b.check_out);
                          const monthStart = new Date(year, m, 1);
                          const monthEnd = new Date(year, m + 1, 0);
                          const clampedStart = start < monthStart ? monthStart : start;
                          const clampedEnd = end > monthEnd ? new Date(year, m + 1, 0) : end;
                          const startDay = clampedStart.getDate();
                          const endDay = clampedEnd.getDate();
                          if (startDay > daysInMonth) return null;
                          const left = ((startDay - 1) / daysInMonth) * 100;
                          const width = ((endDay - startDay + (end > monthEnd ? 1 : 0)) / daysInMonth) * 100;
                          return (
                            <button
                              key={b.id}
                              onClick={() => setSelectedBooking(b)}
                              className={`absolute top-0 h-full rounded text-[9px] text-white px-1 truncate ${platformColor(b.platform)} hover:opacity-80`}
                              style={{ left: `${left}%`, width: `${Math.max(width, 2)}%` }}
                              title={`${b.guest_name} (${b.check_in} → ${b.check_out})`}
                            >
                              {b.guest_name}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Booking detail sheet */}
      {selectedBooking && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setSelectedBooking(null)}>
          <div className="absolute inset-0 bg-black/30" />
          <div className="relative w-full max-w-md bg-white shadow-xl h-full overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">Booking details</h3>
              <button onClick={() => setSelectedBooking(null)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <p className="text-lg font-semibold text-gray-900">{selectedBooking.guest_name}</p>
                <PlatformBadge platform={selectedBooking.platform} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <InfoItem label="Property" value={selectedBooking.property_name || `Property #${selectedBooking.property_id}`} />
                <InfoItem label="Guests" value={selectedBooking.num_guests?.toString() || '-'} />
                <InfoItem label="Check-in" value={new Date(selectedBooking.check_in).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' })} />
                <InfoItem label="Check-out" value={new Date(selectedBooking.check_out).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' })} />
                <InfoItem label="Nights" value={String(selectedBooking.length_of_stay || Math.ceil((new Date(selectedBooking.check_out).getTime() - new Date(selectedBooking.check_in).getTime()) / 86400000))} />
                <InfoItem label="Total price" value={selectedBooking.total_price ? `${selectedBooking.currency || 'ZAR'} ${selectedBooking.total_price.toLocaleString()}` : '-'} />
                <InfoItem label="Per night" value={selectedBooking.price_per_night ? `${selectedBooking.currency || 'ZAR'} ${selectedBooking.price_per_night.toLocaleString()}` : '-'} />
                <InfoItem label="Lead time" value={selectedBooking.lead_time_days != null ? `${selectedBooking.lead_time_days} days` : '-'} />
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-sm font-medium text-gray-900">{value}</p>
    </div>
  );
}
