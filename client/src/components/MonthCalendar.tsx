import React, { useMemo, useState } from 'react';
import {
  Booking,
  TODAY,
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

  // Names the three months on screen, e.g. "Aug – Oct 2026".
  const rangeLabel = useMemo(() => {
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const last = new Date(anchor.getFullYear(), anchor.getMonth() + 2, 1);
    const mon = (d: Date) => d.toLocaleDateString('en-ZA', { month: 'short' });
    return first.getFullYear() === last.getFullYear()
      ? `${mon(first)} – ${mon(last)} ${last.getFullYear()}`
      : `${mon(first)} ${first.getFullYear()} – ${mon(last)} ${last.getFullYear()}`;
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
      type Seg = {
        booking: Booking; rowIdx: number; startCol: number; endCol: number;
        startDate: Date; endDate: Date;
      };
      const segments: Seg[] = [];
      bookings.forEach((booking) => {
        let currentSegment: Seg | null = null;
        cells.forEach((cell, idx) => {
          // Two conditions, and the first one is easy to miss.
          //
          // `!isOtherMonth`: every month's grid pads its first and last
          // rows with days from the neighbouring months. Those cells are
          // rendered `invisible`, but the bar layer floats above the grid
          // and did not consult the flag — so a stay ending 31 July drew
          // itself across August's leading row, under blank date cells,
          // looking for all the world like an August booking. It is also
          // drawn correctly in July's own grid directly above. Clip it.
          //
          // Inclusive of check-out: the nights sold run [checkIn,
          // checkOut), but the bar has to reach into the check-out
          // morning, and half a cell is trimmed off each end below.
          const isInBooking =
          !cell.isOtherMonth &&
          cell.date >= booking.checkIn && cell.date <= booking.checkOut;
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
                startDate: cell.date,
                endDate: cell.date
              };
            } else {
              currentSegment.endCol = colIdx;
              currentSegment.endDate = cell.date;
            }
          } else if (currentSegment) {
            segments.push(currentSegment);
            currentSegment = null;
          }
        });
        // TypeScript can't follow the assignments made inside the forEach
        // callback above, so it narrows this to null. Re-widen at the read.
        const trailing = currentSegment as Seg | null;
        if (trailing) segments.push(trailing);
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
      {/* The middle slot used to hold a "Today" button that disabled
          itself whenever you were already on the current month — which is
          the default view, so it sat there greyed out doing nothing and
          reading as broken. A pager's centre should name what you are
          looking at; the jump-back only appears once it has somewhere to
          jump to. */}
      <div className="flex items-center gap-1 px-3 py-2.5">
        <button
          onClick={() => shiftAnchor(-1)}
          aria-label="Previous month"
          className="w-9 h-9 shrink-0 rounded-full flex items-center justify-center text-[#222222] hover:bg-[#F7F7F7] active:bg-[#F0F0F0] transition-colors">
          <ChevronLeft className="w-5 h-5" strokeWidth={2} />
        </button>

        <div className="flex-1 text-center text-[14px] font-semibold text-[#222222] truncate">
          {rangeLabel}
        </div>

        {!isOnCurrentMonth &&
        <button
          onClick={goToToday}
          className="shrink-0 text-[12px] font-semibold px-3 py-1.5 rounded-full border border-[#DDDDDD] text-[#222222] hover:bg-[#F7F7F7] active:bg-[#F0F0F0] transition-colors">
          Today
        </button>
        }

        <button
          onClick={() => shiftAnchor(1)}
          aria-label="Next month"
          className="w-9 h-9 shrink-0 rounded-full flex items-center justify-center text-[#222222] hover:bg-[#F7F7F7] active:bg-[#F0F0F0] transition-colors">
          <ChevronRight className="w-5 h-5" strokeWidth={2} />
        </button>
      </div>

        {/* Two letters, not one: "S M T W T F S" repeats T and S, so the
            column you land on has to be counted rather than read. Bold and
            near-black — at #B0B0B0 the header was fainter than the dates
            it labels. */}
        <div className="grid grid-cols-7 pb-2 text-[11px] font-semibold text-[#222222] text-center uppercase tracking-[0.4px]">
          {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) =>
          <div key={d} className={d === 'Su' || d === 'Sa' ? 'text-[#717171]' : ''}>{d}</div>
          )}
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
              const isWeekend = cell.date.getDay() === 0 || cell.date.getDay() === 6;
              const rate = getRate(propertyId, cell.date);
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
                  className={`h-[88px] relative flex flex-col items-center pt-2 ${borderTop} ${cell.isOtherMonth ? 'invisible' : ''} ${isPast ? 'opacity-45' : ''} ${isWeekend && !isToday ? 'bg-[#FAFAFA]' : ''} ${isToday ? 'bg-[#F0F0F0]' : ''}`}>

                    {/* Day number.
                        Today used to be a filled #FF385C disc — the same
                        pink the Airbnb bars use, so the marker read as a
                        booking on that date rather than as the date. A
                        channel colour cannot also mean "you are here".
                        Neutral charcoal instead: unmistakable, and it says
                        nothing about who sold the night. */}
                    <div
                    className={`w-[26px] h-[26px] rounded-full flex items-center justify-center text-[13px] relative z-10
                        ${isToday ? 'bg-[#222222] text-white font-semibold' : 'text-[#222222] font-normal'}
                      `}>
                    
                      {cell.date.getDate()}
                    </div>

                    {/* Nightly rate, straight from Smoobu. Blank where no
                        rate is synced — the calendar no longer guesses. */}
                    {!cell.isOtherMonth && !isCovered && rate &&
                  <div
                    className={`mt-0.5 text-[10px] tabular-nums ${
                      rate.available ? 'text-[#717171]' : 'text-[#C13515]'
                    }`}>
                        {rate.available ? formatRate(rate.price) : 'Closed'}
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
              // Trim only where the bar genuinely begins or ends. A
              // segment cut short by a row break — or by the month edge —
              // must run flush to that edge and continue in the next row
              // or the neighbouring month's grid.
              const isFirst = dateEqual(seg.startDate, seg.booking.checkIn);
              const isLast = dateEqual(seg.endDate, seg.booking.checkOut);
              const cellWidthPct = 100 / 7;
              let leftPct = seg.startCol * cellWidthPct;
              let widthPct = (seg.endCol - seg.startCol + 1) * cellWidthPct;
              // Half a cell off each end: the bar starts mid-check-in-day
              // and ends mid-check-out-day, so a departure and an arrival
              // on the same date visibly share it. The end used to be
              // trimmed by 0.25 of the *last night's* cell, which stopped
              // the bar three-quarters of the way through the final night
              // and never reached the check-out day at all.
              if (isFirst) {
                leftPct += cellWidthPct * 0.5;
                widthPct -= cellWidthPct * 0.5;
              }
              if (isLast) {
                widthPct -= cellWidthPct * 0.5;
              }
              // A same-day check-in/check-out would otherwise be invisible.
              widthPct = Math.max(widthPct, cellWidthPct * 0.25);
              // Top offset: row index * 88px (cell height) + 38px (vertical offset)
              const topPx = seg.rowIdx * 88 + 38;
              // Border radius logic
              const isSingleRow = isFirst && isLast;
              let borderRadius = '0';
              if (isSingleRow) borderRadius = '13px';else
              if (isFirst) borderRadius = '13px 0 0 13px';else
              if (isLast) borderRadius = '0 13px 13px 0';
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