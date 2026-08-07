import React, { useMemo } from 'react';
import {
  Booking,
  Property,
  TODAY,
  cleaners,
  getRate,
  formatRate,
  isDateCovered,
  dateEqual } from
'../data/properties';
import { BookingBar } from './BookingBar';
interface TimelineViewProps {
  properties: Property[];
  bookings: Booking[];
  onBookingClick: (booking: Booking) => void;
}
export function TimelineView({
  properties,
  bookings,
  onBookingClick
}: TimelineViewProps) {
  // Generate 28 days starting from TODAY
  const dates = useMemo(() => {
    const arr = [];
    for (let i = 0; i < 28; i++) {
      const d = new Date(TODAY);
      d.setDate(d.getDate() + i);
      arr.push(d);
    }
    return arr;
  }, []);
  const dayNames = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  const CELL_WIDTH = 50;
  const ROW_HEIGHT = 90;
  return (
    <div className="flex flex-col h-full overflow-auto bg-white">
      <div className="min-w-max">
        {/* Header Row */}
        <div className="flex sticky top-0 z-30 bg-white border-b border-[#F0F0F0]">
          {/* Top-Left Empty Corner */}
          <div className="w-[110px] shrink-0 sticky left-0 z-40 bg-white shadow-[2px_0_4px_rgba(0,0,0,0.04)]" />

          {/* Dates Header */}
          <div className="flex">
            {dates.map((date, idx) => {
              const isWeekend = date.getDay() === 0 || date.getDay() === 6;
              const isToday = dateEqual(date, TODAY);
              const isPast = date < TODAY;
              return (
                <div
                  key={idx}
                  className={`w-[50px] shrink-0 py-2 px-1 text-center ${isWeekend ? 'bg-[#FAFAFA]' : 'bg-white'}`}>
                  
                  {/* Weekends emphasised — they are the premium nights,
                      and the column tint already says so. */}
                  <div className={`text-[9px] uppercase leading-tight font-semibold ${
                    isWeekend ? 'text-[#222222]' : 'text-[#8A8A8A]'
                  }`}>
                    {dayNames[date.getDay()]}
                  </div>
                  <div
                    className={`mt-0.5 text-[13px] font-normal mx-auto flex items-center justify-center
                    ${isToday ? 'w-[26px] h-[26px] bg-[#222222] text-white rounded-full font-semibold' : 'text-[#222222]'}
                    ${isPast && !isToday ? 'opacity-30' : ''}
                  `}>
                    
                    {date.getDate()}
                  </div>
                </div>);

            })}
          </div>
        </div>

        {/* Property Rows */}
        {properties.map((prop) => {
          // Calculate segments for this property
          const propBookings = bookings.filter((b) => b.propId === prop.id);
          const segments: {
            booking: Booking;
            startIdx: number;
            endIdx: number;
            isFirst: boolean;
            isLast: boolean;
          }[] = [];
          propBookings.forEach((booking) => {
            let currentSegment = null;
            dates.forEach((date, idx) => {
              // Inclusive of check-out; half a cell is trimmed off each
              // end below so the bar ends mid-check-out-day.
              const isInBooking =
              date >= booking.checkIn && date <= booking.checkOut;
              if (isInBooking) {
                if (!currentSegment) {
                  currentSegment = {
                    booking,
                    startIdx: idx,
                    endIdx: idx,
                    isFirst: date.getTime() === booking.checkIn.getTime(),
                    isLast: date.getTime() === booking.checkOut.getTime()
                  };
                } else {
                  currentSegment.endIdx = idx;
                  // Only the real check-out closes the bar. Running off the
                  // end of the 28-day strip must not trim it — that made an
                  // ongoing stay look like it ended at the window edge.
                  currentSegment.isLast =
                  date.getTime() === booking.checkOut.getTime();
                }
              } else if (currentSegment) {
                segments.push(currentSegment);
                currentSegment = null;
              }
            });
            if (currentSegment) {
              segments.push(currentSegment);
            }
          });
          return (
            <div
              key={prop.id}
              className="flex border-b border-[#F0F0F0] min-h-[90px]">
              
              {/* Sticky Property Name */}
              <div className="w-[110px] shrink-0 sticky left-0 z-20 bg-white shadow-[2px_0_4px_rgba(0,0,0,0.04)] p-3 flex flex-col justify-start">
                <div className="text-[12px] font-semibold text-[#222222] leading-tight">
                  {prop.name}
                </div>
                {/* `base` is Smoobu's minimum-price floor (R80 on The
                    loft), not a nightly rate — quoting it here read as a
                    price. Rates now live per-day in the grid. */}
              </div>

              {/* Cells and Bars Container */}
              <div className="flex relative">
                {/* Background Cells */}
                {dates.map((date, idx) => {
                  const isWeekend = date.getDay() === 0 || date.getDay() === 6;
                  const isCovered = isDateCovered(date, prop.id);
                  const rate = getRate(prop.id, date);
                  const hasCleaner = cleaners[prop.id]?.includes(date.getDate());
                  return (
                    <div
                      key={idx}
                      className={`w-[50px] shrink-0 relative ${
                      rate && !rate.available ? 'bg-[#F2F2F2]' :
                      isWeekend ? 'bg-[#FAFAFA]' : 'bg-white'}`}>

                      {/* The date row above is shared by every property, so
                          a closed night is marked on the cell itself. */}
                      {!isCovered && rate &&
                      <div className={`absolute bottom-2 left-0 right-0 text-center text-[10px] whitespace-nowrap tabular-nums font-medium ${
                        rate.available ? 'text-[#222222]' : 'text-[#8A8A8A] line-through decoration-[1.5px]'
                      }`}>
                          {formatRate(rate.price)}
                        </div>
                      }
                      {hasCleaner &&
                      <div className="absolute w-[5px] h-[5px] bg-[#00A699] rounded-full bottom-2 left-1/2 -translate-x-1/2" />
                      }
                    </div>);

                })}

                {/* Bars Layer */}
                <div className="absolute top-[32px] left-0 right-0 bottom-0 pointer-events-none z-10">
                  {segments.map((seg, sIdx) => {
                    let left = seg.startIdx * CELL_WIDTH;
                    let width = (seg.endIdx - seg.startIdx + 1) * CELL_WIDTH;
                    if (seg.isFirst) {
                      left += CELL_WIDTH * 0.5;
                      width -= CELL_WIDTH * 0.5;
                    }
                    if (seg.isLast) {
                      width -= CELL_WIDTH * 0.5;
                    }
                    width = Math.max(width, CELL_WIDTH * 0.25);
                    let borderRadius = '0';
                    if (seg.isFirst && seg.isLast) borderRadius = '13px';else
                    if (seg.isFirst) borderRadius = '13px 0 0 13px';else
                    if (seg.isLast) borderRadius = '0 13px 13px 0';
                    return (
                      <BookingBar
                        key={`${seg.booking.id}-${sIdx}`}
                        booking={seg.booking}
                        onClick={onBookingClick}
                        style={{
                          left: `${left}px`,
                          width: `${width}px`,
                          top: '0px',
                          borderRadius,
                          pointerEvents: 'auto'
                        }} />);


                  })}
                </div>
              </div>
            </div>);

        })}
      </div>
    </div>);

}