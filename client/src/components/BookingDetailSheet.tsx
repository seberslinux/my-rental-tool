import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Booking, properties, formatTotal, stayStatus, holidaysDuring , cleanForBooking } from '../data/properties';
import { fmtParty } from '../data/format';
import { ChecklistEditor } from './ChecklistEditor';

interface BookingDetailSheetProps {
  booking: Booking | null;
  onClose: () => void;
  /**
   * Ask for a cleaner for this stay or block.
   *
   * Offered here because this is where you already are when you notice
   * the need: looking at the bar. Given the date and the property, so the
   * next screen has nothing left to guess.
   */
  onRequestCleaner?: (date: string, propertyId: number, reason: 'checkout' | 'checkin' | 'other') => void;
}

/**
 * Booking detail.
 *
 * A bottom sheet on a phone, where it belongs — thumb-reachable, and the
 * sheet metaphor is the platform convention. On a laptop the same sheet
 * spanning a 1900px window put its close button a full screen-width from
 * its title and left most of the panel empty, so from `sm` up it becomes a
 * centred dialog of readable width.
 */
export function BookingDetailSheet({ booking, onClose, onRequestCleaner }: BookingDetailSheetProps) {
  // Extras asked for on this stay alone.
  const [editingExtras, setEditingExtras] = useState(false);
  // Escape closes it — on a laptop the click target is far from the pointer.
  useEffect(() => {
    if (!booking) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [booking, onClose]);

  if (!booking) return null;

  const property = properties.find((p) => p.id === booking.propId);
  const nights = Math.round(
    (booking.checkOut.getTime() - booking.checkIn.getTime()) / (1000 * 60 * 60 * 24)
  );
  const perNight = nights > 0 ? Math.round(booking.total / nights) : 0;
  const isBlocked = booking.type === 'blocked';
  // The clean that follows this stay, if one is arranged.
  const linkedClean = booking.type === 'blocked' ? null : cleanForBooking(booking);

  const getPlatformDetails = (type: string) => {
    switch (type) {
      case 'airbnb':
        return { name: 'Airbnb', bg: 'bg-[#FF385C]', text: 'text-white' };
      case 'bcom':
        return { name: 'Booking.com', bg: 'bg-[#003580]', text: 'text-white' };
      case 'direct':
        return { name: 'Direct Booking', bg: 'bg-[#717171]', text: 'text-white' };
      case 'blocked':
        return { name: 'Blocked Dates', bg: 'bg-[#EBEBEB]', text: 'text-[#717171]' };
      default:
        return { name: type, bg: 'bg-gray-200', text: 'text-gray-800' };
    }
  };
  const platform = getPlatformDetails(booking.type);
  const overlapping = holidaysDuring(booking);

  const fmtDate = (d: Date) =>
    d.toLocaleDateString('en-ZA', { weekday: 'short', month: 'short', day: 'numeric' });

  const Row = ({
    label,
    value,
    muted = false,
  }: {
    label: string;
    value: React.ReactNode;
    muted?: boolean;
  }) =>
  <div className="flex justify-between items-center py-3 border-b border-[#EBEBEB] last:border-0">
      <span className={`text-[14px] ${muted ? 'text-[#717171]' : 'text-[#222222]'}`}>
        {label}
      </span>
      <span className={`text-[14px] tabular-nums ${muted ? 'text-[#717171]' : 'text-[#222222] font-medium'}`}>
        {value}
      </span>
    </div>;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/30 z-[60] transition-opacity"
        onClick={onClose} />

      {/* Bottom sheet on mobile; centred dialog from `sm` up. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Booking detail for ${booking.name}`}
        className="fixed z-[70] bg-white shadow-2xl
                   inset-x-0 bottom-0 rounded-t-[16px] pb-8
                   max-h-[88vh] overflow-y-auto
                   sm:inset-auto sm:left-1/2 sm:top-1/2
                   sm:-translate-x-1/2 sm:-translate-y-1/2
                   sm:w-[min(420px,calc(100vw-3rem))]
                   sm:rounded-2xl sm:pb-0 sm:max-h-[85vh]">

        {/* Drag affordance — mobile only; there is nothing to drag on desktop. */}
        <div className="flex justify-center pt-3 pb-1 sm:hidden">
          <div className="w-[36px] h-[4px] bg-[#DDDDDD] rounded-full" />
        </div>

        <div className="px-6 pt-4 pb-6 sm:pt-6">
          <div className="flex justify-between items-start gap-4 mb-6">
            <div className="min-w-0">
              <h2 className="text-[20px] font-semibold text-[#222222] leading-tight truncate">
                {booking.name}
              </h2>
              <p className="text-[13px] text-[#717171] mt-0.5">{property?.name}</p>
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="shrink-0 p-1.5 bg-[#F7F7F7] rounded-full hover:bg-[#EBEBEB] transition-colors">
              <X className="w-4 h-4 text-[#222222]" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-6">
            <div className="border border-[#EBEBEB] p-3 rounded-xl">
              <p className="text-[10px] text-[#717171] uppercase font-semibold mb-1 tracking-wide">
                Check-in
              </p>
              <p className="font-medium text-[#222222] text-[14px]">
                {fmtDate(booking.checkIn)}
              </p>
              {!isBlocked && <p className="text-[12px] text-[#717171] mt-0.5">From 15:00</p>}
            </div>
            <div className="border border-[#EBEBEB] p-3 rounded-xl">
              <p className="text-[10px] text-[#717171] uppercase font-semibold mb-1 tracking-wide">
                Check-out
              </p>
              <p className="font-medium text-[#222222] text-[14px]">
                {fmtDate(booking.checkOut)}
              </p>
              {!isBlocked && <p className="text-[12px] text-[#717171] mt-0.5">By 10:00</p>}
            </div>
          </div>

          {/* "Status: Airbnb" answered the wrong question — Airbnb is who
              sold the stay, not what is happening to it. Two rows now. */}
          <Row label="Status" value={stayStatus(booking)} />
          {/* A block has no channel — it was not sold. Showing "Blocked"
              twice, once per row, said nothing the second time. */}
          {!isBlocked &&
          <Row label="Channel" value={
            <span className={`px-2.5 py-1 rounded-full text-[12px] font-medium ${platform.bg} ${platform.text}`}>
              {platform.name}
            </span>
          } />
          }
          <Row label="Duration" value={`${nights} ${nights === 1 ? 'night' : 'nights'}`} />
          {/* Party size, children included — the number that decides linen,
              keys and what the cleaner is told to expect. Shared formatter,
              so it cannot disagree with the dashboard's count. */}
          {!isBlocked &&
          <Row
            label="Guests"
            value={fmtParty({ num_guests: booking.numGuests, children: booking.children })} />
          }

          {/* Holidays the stay runs through.
              On a booking already made this explains it — a Hamburg
              family arriving inside the Hamburg school break is not a
              coincidence, and it is the difference between a rate that
              was right and one that was left on the table. On a block it
              is a warning: this is a peak week you have taken off sale.

              Hidden when nothing matches, because nothing matching also
              means "outside the horizon the server sent" — see
              holidaysDuring(). An empty row would read as "no holiday",
              which is a stronger claim than we can make. */}
          {overlapping.length > 0 &&
          <Row
            label={overlapping.length === 1 ? 'Holiday' : 'Holidays'}
            value={
            <span className="flex flex-col items-end gap-0.5">
                {overlapping.slice(0, 3).map((h) =>
              <span key={`${h.label}-${h.start}-${h.name}`} className="text-[13px]">
                    {h.name}
                    <span className="text-[#717171] font-normal"> · {h.label}</span>
                  </span>
              )}
                {overlapping.length > 3 &&
              <span className="text-[12px] text-[#717171] font-normal">
                    +{overlapping.length - 3} more
                  </span>
              }
              </span>
            } />
          }

          {/* Money.
              This used to be a single line labelled "Total Payout" showing
              the gross — R6,025 on a booking that pays out R4,951, because
              Airbnb's commission was never subtracted. Gross and net are
              now both shown, with the deduction between them, so the
              R1,074 gap is visible rather than silently absorbed.
              `deductions` and `netPayout` come from the server's
              calcDeductions — the same function behind the dashboard KPIs
              and the analytics page. Nothing is recomputed in the client. */}
          {!isBlocked && booking.total > 0 &&
          <div className="mt-5 rounded-xl bg-[#F7F7F7] px-4 py-3">
              <Row label="Guest total" value={formatTotal(booking.total)} muted />
              {nights > 0 && <Row label="Per night" value={formatTotal(perNight)} muted />}
              {booking.deductions > 0 &&
              <Row
                label="Commission & fees"
                value={`− ${formatTotal(booking.deductions)}`}
                muted />
              }
              <div className="flex justify-between items-center pt-3">
                <span className="text-[14px] font-medium text-[#222222]">Your payout</span>
                <span className="text-[20px] font-semibold text-[#222222] tabular-nums">
                  {formatTotal(booking.netPayout)}
                </span>
              </div>
            </div>
          }

          {isBlocked &&
          <p className="mt-5 text-[13px] text-[#717171] rounded-xl bg-[#F7F7F7] px-4 py-3">
              These dates are blocked and not for sale.
            </p>
          }

          {/* Who is turning it over afterwards. The stay and the clean
              were two unrelated things on screen — the bar said who was
              here, and whether anybody was coming to deal with it lived
              on a different day in a different colour. */}
          {!isBlocked && (() => {
            if (!linkedClean) return null;
            const clean = linkedClean;
            const when = new Date(clean.date + 'T00:00:00').toLocaleDateString('en-ZA', {
              weekday: 'short', day: 'numeric', month: 'short',
            });
            return (
              <div className="mt-5 rounded-xl bg-[#F7F7F7] px-4 py-3">
                <p className="text-[12px] font-semibold uppercase tracking-[0.3px] text-[#B0B0B0] mb-1">
                  Cleaning after
                </p>
                <p className="text-[14px] font-medium text-[#222222]">
                  {clean.cleaner_name} · {when}, {clean.start_time}–{clean.end_time}
                </p>
                <p className="text-[13px] text-[#717171]">
                  {clean.status === 'pending' ? 'Waiting for them to accept' :
                  clean.status === 'confirmed' ? 'Accepted' :
                  clean.status === 'in_progress' ? 'On site now' :
                  clean.status === 'completed' ? 'Done' : clean.status}
                </p>
                {!clean.cleaner_available &&
                <p className="text-[13px] text-[#92400E] mt-0.5">
                    They have since marked themselves unavailable that day.
                  </p>
                }
                {onRequestCleaner &&
                <button
                  onClick={() => onRequestCleaner(clean.date, booking.propId, 'checkout')}
                  className="mt-2 text-[13px] font-semibold text-[#222222] underline underline-offset-2">
                    Change who is coming
                  </button>
                }
              </div>);

          })()}

          {/* A stay wants cleaning when the guests leave. A block wants it
              whenever you say — nobody is checking out of one, so the day
              it starts is only a sensible guess. */}
          {/* Anything wanted for this stay in particular. The property's
              standing list covers towels and coffee pods; this is where a
              cot, or a set of glasses the last guests broke, gets counted
              once and never again. */}
          {!isBlocked &&
          <button
            onClick={() => setEditingExtras(true)}
            className="mt-3 w-full h-[44px] rounded-[10px] border border-[#DDDDDD] text-[14px] font-semibold hover:bg-[#F7F7F7]">
              Checklist just for this stay
            </button>
          }

          {/* Only when there is nothing arranged. With a cleaner already
              named above, this button asked a question that had been
              answered — and the way to change that answer is on the day
              itself, where the alternatives are. */}
          {onRequestCleaner && !linkedClean &&
          <button
            onClick={() => {
              const d = isBlocked ? booking.checkIn : booking.checkOut;
              const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
              onRequestCleaner(key, booking.propId, isBlocked ? 'other' : 'checkout');
            }}
            className="mt-5 w-full h-[44px] rounded-[10px] border border-[#DDDDDD] text-[14px] font-semibold hover:bg-[#F7F7F7]">
              Request a cleaner
            </button>
          }
        </div>
      </div>

      {editingExtras &&
      <ChecklistEditor
        propertyId={booking.propId}
        propertyName={property ? property.name : ''}
        bookingId={booking.smoobuId}
        guestName={booking.name}
        onClose={() => setEditingExtras(false)} />
      }
    </>);

}
