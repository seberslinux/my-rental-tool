import React, { useMemo, useState } from 'react';
import {
  Booking,
  TODAY,
  HOLIDAY,
  CLEANER_TOGGLE,
  cleaners,
  getRate,
  formatRate,
  isDateCovered,
  dateEqual } from
'../data/properties';
import { BookingBar } from './BookingBar';
import { ChevronLeft, ChevronRight } from 'lucide-react';
interface MonthCalendarProps {
  propertyId: number;
  bookings: Booking[];
  onBookingClick: (booking: Booking) => void;
}
export function MonthCalendar({
  propertyId,
  bookings,
  onBookingClick
}: MonthCalendarProps) {
  // The months shown were hardcoded to March–May 2026, so the calendar
  // never moved: by August every day it drew was in the past, and the
  // past-dimming styling greyed out the entire grid. Anchor on the current
  // month instead, and let the arrows page through.
  const [anchor, setAnchor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  const shiftAnchor = (months: number) =>
    setAnchor((a) => new Date(a.getFullYear(), a.getMonth() + months, 1));

  const goToToday = () => {
    const now = new Date();
    setAnchor(new Date(now.getFullYear(), now.getMonth(), 1));
  };

  const isOnCurrentMonth = useMemo(() => {
    const now = new Date();
    return anchor.getFullYear() === now.getFullYear() && anchor.getMonth() === now.getMonth();
  }, [anchor]);

  const monthsData = useMemo(() => {
    return [0, 1, 2].
    map((offset) => {
      const first = new Date(anchor.getFullYear(), anchor.getMonth() + offset, 1);
      const year = first.getFullYear();
      const month = first.getMonth() + 1; // the maths below is 1-indexed
      const name = first.toLocaleDateString('en-ZA', { month: 'long' });
      return { year, month, name };
    }).
    map(({ year, month, name }) => {
      const daysInMonth = new Date(year, month, 0).getDate();
      const firstDay = new Date(year, month - 1, 1).getDay();
      const prevMonth = month === 1 ? 12 : month - 1;
      const prevYear = month === 1 ? year - 1 : year;
      const daysInPrevMonth = new Date(prevYear, prevMonth, 0).getDate();
      const cells: { date: Date; isOtherMonth: boolean }[] = [];
      // Prev month cells
      for (let i = firstDay - 1; i >= 0; i--) {
        cells.push({
          date: new Date(prevYear, prevMonth - 1, daysInPrevMonth - i),
          isOtherMonth: true
        });
      }
      // Current month cells
      for (let day = 1; day <= daysInMonth; day++) {
        cells.push({
          date: new Date(year, month - 1, day),
          isOtherMonth: false
        });
      }
      // Next month cells
      const remainingCells = 42 - cells.length;
      const nextMonth = month === 12 ? 1 : month + 1;
      const nextYear = month === 12 ? year + 1 : year;
      for (let day = 1; day <= remainingCells; day++) {
        cells.push({
          date: new Date(nextYear, nextMonth - 1, day),
          isOtherMonth: true
        });
      }
      // Calculate booking segments for this month's grid
      const segments: {
        booking: Booking;
        rowIdx: number;
        startCol: number;
        endCol: number;
        isFirst: boolean;
        isLast: boolean;
      }[] = [];
      bookings.forEach((booking) => {
        type Seg = {
          booking: Booking; rowIdx: number; startCol: number;
          endCol: number; isFirst: boolean; isLast: boolean;
        };
        let currentSegment: Seg | null = null;
        cells.forEach((cell, idx) => {
          const isInBooking =
          cell.date >= booking.checkIn && cell.date < booking.checkOut;
          const rowIdx = Math.floor(idx / 7);
          const colIdx = idx % 7;
          if (isInBooking) {
            if (!currentSegment || currentSegment.rowIdx !== rowIdx) {
              if (currentSegment) segments.push(currentSegment);
              currentSegment = {
                booking,
                rowIdx,
                startCol: colIdx,
                endCol: colIdx,
                isFirst: idx === 0 || cells[idx - 1].date < booking.checkIn,
                isLast: false
              };
            } else {
              currentSegment.endCol = colIdx;
            }
          } else if (currentSegment) {
            currentSegment.isLast = true;
            segments.push(currentSegment);
            currentSegment = null;
          }
        });
        // TypeScript can't follow the assignments made inside the forEach
        // callback above, so it narrows this to null. Re-widen at the read.
        const trailing = currentSegment as Seg | null;
        if (trailing) {
          trailing.isLast = true;
          segments.push(trailing);
        }
      });
      return {
        name,
        year,
        cells,
        segments
      };
    });
  }, [bookings, anchor]);
  return (
    <div className="pb-10 bg-white">
      {/* Paging. Sticky so it stays reachable while scrolling three months
          of grid on a phone. */}
      <div className="sticky top-0 z-20 bg-white/95 backdrop-blur-sm border-b border-[#F0F0F0]">
      <div className="flex items-center justify-between px-4 py-2.5">
        <button
          onClick={() => shiftAnchor(-1)}
          aria-label="Previous month"
          className="w-9 h-9 rounded-full flex items-center justify-center text-[#222222] hover:bg-[#F7F7F7] active:bg-[#F0F0F0] transition-colors">
          <ChevronLeft className="w-5 h-5" strokeWidth={2} />
        </button>

        <button
          onClick={goToToday}
          disabled={isOnCurrentMonth}
          className={`text-[13px] font-medium px-3 py-1.5 rounded-full transition-colors ${
            isOnCurrentMonth
              ? 'text-[#B0B0B0] cursor-default'
              : 'text-[#FF385C] hover:bg-[#FFF0F3]'
          }`}>
          Today
        </button>

        <button
          onClick={() => shiftAnchor(1)}
          aria-label="Next month"
          className="w-9 h-9 rounded-full flex items-center justify-center text-[#222222] hover:bg-[#F7F7F7] active:bg-[#F0F0F0] transition-colors">
          <ChevronRight className="w-5 h-5" strokeWidth={2} />
        </button>
      </div>

        <div className="grid grid-cols-7 pb-2 text-[11px] font-medium text-[#B0B0B0] text-center uppercase tracking-[0.5px]">
          <div>S</div><div>M</div><div>T</div><div>W</div><div>T</div><div>F</div><div>S</div>
        </div>
      </div>

      {monthsData.map((month, mIdx) =>
      <div key={mIdx} className="pb-8">
          <div className="text-[20px] font-semibold text-[#222222] pt-6 pl-6 pb-4">
            {month.name} {month.year}
          </div>

          <div className="relative">
            {/* Grid */}
            <div className="grid grid-cols-7 gap-0">
              {month.cells.map((cell, idx) => {
              const isPast = cell.date < TODAY;
              const isToday = dateEqual(cell.date, TODAY);
              const isHoliday = dateEqual(cell.date, HOLIDAY);
              const isWeekend =
              cell.date.getDay() === 0 || cell.date.getDay() === 6;
              const hasCleaner =
              CLEANER_TOGGLE &&
              !cell.isOtherMonth &&
              cleaners[propertyId]?.includes(cell.date.getDate());
              const isCovered = isDateCovered(cell.date, propertyId);
              // Add subtle horizontal line between weeks
              const isFirstRow = idx < 7;
              const borderTop =
              !isFirstRow && idx % 7 === 0 ?
              'border-t border-[#F0F0F0]' :
              '';
              return (
                <div
                  key={idx}
                  className={`h-[88px] relative flex flex-col items-center pt-2 ${borderTop} ${cell.isOtherMonth ? 'invisible' : ''} ${isPast ? 'opacity-30' : ''}`}>
                  
                    {/* Day Number */}
                    <div
                    className={`w-[26px] h-[26px] rounded-full flex items-center justify-center text-[13px] font-normal relative z-10
                        ${isToday ? 'bg-[#FF385C] text-white font-medium' : 'text-[#222222]'}
                        ${isHoliday && !isToday ? 'shadow-[inset_0_0_0_1.5px_#222222]' : ''}
                      `}>
                    
                      {cell.date.getDate()}
                    </div>

                    {/* Rate */}
                    {!cell.isOtherMonth && !isCovered &&
                  <div
                    className={`mt-0.5 text-[10px] ${isWeekend ? 'text-[#00A699]' : 'text-[#717171]'}`}>
                    
                        {formatRate(getRate(propertyId, cell.date))}
                      </div>
                  }

                    {/* Cleaner Dot */}
                    {hasCleaner &&
                  <div className="absolute w-[5px] h-[5px] bg-[#00A699] rounded-full bottom-2 left-1/2 -translate-x-1/2" />
                  }
                  </div>);

            })}
            </div>

            {/* Bars Layer */}
            <div className="absolute inset-0 pointer-events-none z-10">
              {month.segments.map((seg, sIdx) => {
              // Responsive percentage calculations
              const cellWidthPct = 100 / 7;
              let leftPct = seg.startCol * cellWidthPct;
              let widthPct = (seg.endCol - seg.startCol + 1) * cellWidthPct;
              if (seg.isFirst) {
                leftPct += cellWidthPct * 0.5;
                widthPct -= cellWidthPct * 0.5;
              }
              if (seg.isLast) {
                widthPct -= cellWidthPct * 0.25;
              }
              // Top offset: row index * 88px (cell height) + 38px (vertical offset)
              const topPx = seg.rowIdx * 88 + 38;
              // Border radius logic
              const isSingleRow = seg.isFirst && seg.isLast;
              let borderRadius = '0';
              if (isSingleRow) borderRadius = '13px';else
              if (seg.isFirst) borderRadius = '13px 0 0 13px';else
              if (seg.isLast) borderRadius = '0 13px 13px 0';
              return (
                <BookingBar
                  key={`${seg.booking.id}-${sIdx}`}
                  booking={seg.booking}
                  onClick={onBookingClick}
                  style={{
                    left: `${leftPct}%`,
                    width: `${widthPct}%`,
                    top: `${topPx}px`,
                    borderRadius,
                    pointerEvents: 'auto'
                  }} />);


            })}
            </div>
          </div>
        </div>
      )}
    </div>);

}