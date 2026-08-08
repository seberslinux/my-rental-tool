import React, { useMemo, useState } from 'react';
import {
  Booking,
  TODAY,
  CLEANER_TOGGLE,
  cleaners,
  getRate,
  formatRate,
  dateKey,
  dateEqual } from
'../data/properties';
import { BookingBar } from './BookingBar';
import { ChevronLeft, ChevronRight, Moon } from 'lucide-react';
interface MonthCalendarProps {
  propertyId: number;
  bookings: Booking[];
  onBookingClick: (booking: Booking) => void;
  /**
   * Nightly rates. Omit to hide them entirely — the cleaner portal uses
   * this same grid and must never show money, and the endpoint that
   * serves rates refuses a cleaner session anyway.
   */
  showRates?: boolean;
  /** How many months to render. The portal wants one, not a quarter. */
  months?: number;
  /**
   * Days to mark with a dot. The manager passes cleaning days from the
   * shared `cleaners` map; the portal passes its own job dates, which is
   * the only version it can see.
   */
  markedDays?: Set<string>;
  /**
   * What a bar says. Defaults to name and total; the portal overrides it
   * to drop the money.
   */
  barLabel?: (booking: Booking) => string;
}
export function MonthCalendar({
  propertyId,
  bookings,
  onBookingClick,
  showRates = true,
  months = 3,
  markedDays,
  barLabel
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
  }, [anchor, months]);

  // Names the three months on screen, e.g. "Aug – Oct 2026".
  const rangeLabel = useMemo(() => {
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const last = new Date(anchor.getFullYear(), anchor.getMonth() + months - 1, 1);
    const mon = (d: Date) => d.toLocaleDateString('en-ZA', { month: 'short' });
    // One month on screen is named, not given a range of itself.
    if (months === 1) {
      return first.toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' });
    }
    return first.getFullYear() === last.getFullYear()
      ? `${mon(first)} – ${mon(last)} ${last.getFullYear()}`
      : `${mon(first)} ${first.getFullYear()} – ${mon(last)} ${last.getFullYear()}`;
  }, [anchor]);

  const monthsData = useMemo(() => {
    return Array.from({ length: months }, (_, i) => i).
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
  }, [bookings, anchor, months]);
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
            it labels.
            Weekends carry the emphasis, not the weekdays. The usual
            calendar convention greys them out because they are the days
            off; here they are the nights that earn the premium — R2.1K
            against R1.6K midweek — and they are what you scan for. The
            shaded weekend columns say the same thing, so muting their
            labels had the header arguing with the grid beneath it. */}
        <div className="grid grid-cols-7 pb-2 px-3 text-[11px] font-semibold text-center uppercase tracking-[0.4px]">
          {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d, i) =>
          <div key={d} className={i === 0 || i === 6 ? 'text-[#222222]' : 'text-[#8A8A8A]'}>{d}</div>
          )}
        </div>
      </div>

      {monthsData.map((month, mIdx) =>
      <div key={mIdx} className="pb-8">
          {months > 1 &&
          <div className="text-[20px] font-semibold text-[#222222] pt-6 pl-6 pb-4">
            {month.name} {month.year}
          </div>
          }

          <div className="relative px-3">
            {/* The grid needs to look like one.
                Cells had no borders at all and neighbouring-month cells
                were `invisible`, so the month rendered as loose numbers
                floating in white with holes punched in the corners. Every
                cell now carries a hairline and the padding cells stay in
                place, empty, holding the rectangle together.

                Weekend columns previously took a grey fill. Run down a
                full month at desktop width that became two floor-to-
                ceiling grey bands reading as damage rather than emphasis —
                the header already carries that signal in one line. */}
            <div className="grid grid-cols-7 gap-0 border-t border-l border-[#EBEBEB]">
              {month.cells.map((cell, idx) => {
              const isPast = cell.date < TODAY;
              const isToday = dateEqual(cell.date, TODAY);
              const rate = showRates ? getRate(propertyId, cell.date) : null;
              const hasCleaner =
              !cell.isOtherMonth && (
              markedDays ?
              markedDays.has(dateKey(cell.date)) :
              CLEANER_TOGGLE && cleaners[propertyId]?.includes(cell.date.getDate()));
              // Covered by a booking passed in, not by the shared list —
              // the portal is given only its own properties' stays.
              const isCovered = bookings.some(
                (b) => b.propId === propertyId && cell.date >= b.checkIn && cell.date < b.checkOut);
              // Smoobu's own block flag: the night is not for sale, which
              // is not the same as having a booking on it.
              const isClosed = rate ? !rate.available : false;
              const edges = 'border-r border-b border-[#EBEBEB]';

              if (cell.isOtherMonth) {
                return <div key={idx} className={`h-[84px] bg-[#FCFCFC] ${edges}`} />;
              }

              return (
                <div
                  key={idx}
                  className={`h-[84px] relative ${edges} ${
                  isToday ? 'bg-[#F7F7F7]' : isClosed ? 'bg-[#F2F2F2]' : ''}`}>

                    {/* Date on the left, price on the right, both on one
                        line at the top. Centring the date and stacking the
                        price beneath it left the booking bars nowhere to
                        sit and wasted the bottom half of every cell. */}
                    <div className="flex items-start justify-between pl-1.5 pr-1.5 pt-1.5">
                      {/* Today used to be a filled #FF385C disc — the same
                          pink the Airbnb bars use, so the marker read as a
                          booking on that date. A channel colour cannot also
                          mean "you are here". */}
                      <div
                      className={`w-[24px] h-[24px] rounded-full flex items-center justify-center text-[13px] shrink-0 font-normal
                          ${isToday ? 'bg-[#222222] text-white font-semibold' : ''}
                          ${isClosed && !isToday ? 'text-[#8A8A8A] line-through decoration-[1.5px]' : ''}
                          ${!isClosed && !isToday ? (isPast ? 'text-[#B0B0B0]' : 'text-[#222222]') : ''}
                        `}>
                        {cell.date.getDate()}
                      </div>

                      {/* Minimum stay, when it is more than one night.
                          It is often the reason a gap will not fill: a
                          two-night minimum makes a one-night hole
                          unsellable at any price, and the nightly rate
                          alone never explains that. Shown only above 1 —
                          "1" against a moon on every open day is noise.

                          The moon is the unit. "2n" needed decoding and
                          a spelt-out "min 2 nights" does not fit a 50px
                          phone cell; a crescent reads as nights at a
                          glance in any language. */}
                      {!isCovered && rate && rate.minStay > 1 &&
                    <span
                      title={`Minimum stay ${rate.minStay} nights`}
                      className={`flex items-center gap-[2px] text-[10px] font-medium tabular-nums pt-[3px] ${
                        isClosed || isPast ? 'text-[#B0B0B0]' : 'text-[#8A8A8A]'
                      }`}>
                          {rate.minStay}
                          <Moon className="w-[9px] h-[9px]" strokeWidth={2.5} />
                        </span>
                    }
                    </div>

                    {/* Nightly rate, straight from Smoobu. Blank where no
                        rate is synced — the calendar no longer guesses.
                        Its own line at the foot of the cell: sharing the
                        top line with the date left it about 20px on a
                        phone, so "R 1.6K" broke across two lines.

                        It reads at 12px near-black rather than 10px grey.
                        Both Airbnb's and Booking.com's calendars make the
                        nightly rate the loudest thing after the date, and
                        they are right to — on an open night it is the one
                        number you act on. Ours whispered it. */}
                    {!isCovered && rate &&
                  <span
                    className={`absolute bottom-2 left-2 text-[12px] font-medium tabular-nums whitespace-nowrap ${
                      isClosed ? 'text-[#8A8A8A]' :
                      isPast ? 'text-[#B0B0B0]' : 'text-[#222222]'
                    }`}>
                        {formatRate(rate.price)}
                      </span>
                  }

                    {/* Cleaner Dot */}
                    {hasCleaner &&
                  <div
                    title="Cleaning scheduled"
                    className="absolute w-[5px] h-[5px] bg-[#00A699] rounded-full bottom-2.5 right-1.5" />
                  }
                  </div>);

            })}
            </div>

            {/* Bars Layer */}
            <div className="absolute inset-y-0 left-3 right-3 pointer-events-none z-10">
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
              // Cell is 84px; the date/price line occupies the top ~30px,
              // so the bar lane starts below it.
              const topPx = seg.rowIdx * 84 + 34;
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
                  label={barLabel}
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