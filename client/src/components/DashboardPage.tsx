import React from 'react';
import { PropertyStatusCard } from './PropertyStatusCard';
import { TodayPanel } from './TodayPanel';
import { X, Check, AlertTriangle, ArrowRight, LogIn, LogOut } from 'lucide-react';
import {
  kpis,
  currentlyStaying,
  agenda,
  upcomingHolidays,
  forwardOccupancy,
  recentCancellations,
  dismissDashboardItem } from
'../data/dashboard';
export function DashboardPage({ onNavigate, onGoToDay, onNeedsChange }: {
  onNavigate?: (tab: string) => void;
  /** Open the calendar on a specific day, with its sheet up. */
  onGoToDay?: (propertyId: number, date: string) => void;
  /** How many things need somebody — passed up for the tab badge. */
  onNeedsChange?: (count: number | null) => void;
}) {
  return (
    <div className="p-4 lg:px-8 lg:py-6 bg-[#F7F7F7] min-h-full">
      {/* What needs somebody, and what is happening — both from one
          call, so they cannot disagree. The board that used to sit here
          had its own idea of whether a checkout had a cleaner, and the
          attention list below had a third. */}
      <TodayPanel onGoToDay={onGoToDay} onNeedsChange={onNeedsChange} />

      <PropertyStatusCard />

      {/* Desktop: 2-column layout (left: attention + staying, right: the rest). Mobile: single column. */}
      <div className="lg:grid lg:grid-cols-3 lg:gap-6 lg:items-start">
      <div className="lg:col-span-2">

      {/* "Needs Attention" stood here — a second opinion on the same
          question the list at the top answers, built from every job row
          with no cleaner on it. Those rows are what a deleted cleaner
          leaves behind, so one removed person produced an item here, a
          "No cleaner" badge on the board, and a warning in the day
          sheet: three contradictory lines for one fact. */}


      {/* Currently Staying */}
      <div className="mb-6">
        <div className="text-[12px] font-semibold uppercase tracking-[0.5px] text-[#B0B0B0] pb-2">
          Currently Staying
        </div>
        <div className="flex flex-col gap-2 lg:grid lg:grid-cols-2 lg:gap-3">
          {currentlyStaying.map((guest) => (
            <div
              key={guest.id}
              className="bg-white rounded-[12px] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)]">

              <div className="flex justify-between items-center mb-2">
                <div className="text-[12px] font-semibold text-[#717171] tracking-[0.2px]">
                  {guest.property}
                </div>
                {guest.isVacant ?
                <span className={`text-[11px] font-semibold px-2 py-[3px] rounded-[6px] tracking-[0.1px] ${guest.guestName === 'Blocked' ? 'bg-[#FEF2F2] text-[#DC2626]' : 'bg-[#F7F7F7] text-[#B0B0B0]'}`}>
                  {guest.guestName}
                </span> :
                <span
                  className={`text-[11px] font-semibold px-2 py-[3px] rounded-[6px] tracking-[0.1px] ${guest.platform === 'Airbnb' ? 'bg-[#FF385C14] text-[#E31C5F]' : 'bg-[#003B9510] text-[#003B95]'}`}>
                  {guest.platform}
                </span>
                }
              </div>

              {guest.isVacant ?
              <div className="text-[14px] text-[#717171]">
                {guest.meta}
              </div> :
              <>
                <div className="text-[18px] font-semibold tracking-[-0.3px] mb-[2px]">
                  {guest.guestName}
                </div>
                <div className="text-[14px] text-[#717171] leading-[1.4]">
                  {guest.meta}
                </div>
                <div className="flex justify-between items-baseline mt-3 pt-3 border-t border-[#F0F0F0]">
                  <div className="text-[16px] font-semibold">
                    {guest.rate}{' '}
                    <span className="font-normal text-[13px] text-[#717171]">
                      /night
                    </span>
                  </div>
                  <div className="text-[14px] text-[#717171]">
                    {guest.total}
                  </div>
                </div>
              </>
              }
            </div>
          ))}
        </div>
      </div>

      {/* Forward occupancy. Horizontal rows rather than columns: at
          10–30% occupancy a vertical bar is a sliver in an empty box,
          while a horizontal track reads cleanly at any fill level and
          leaves room for the free-night count, which is the number you
          can actually act on.

          The heading names occupancy rather than "nights still to sell"
          because the bar and the percentage both show what is BOOKED. Under
          the old heading a nearly-empty month drew a nearly-empty bar, which
          read as "almost nothing left to sell" — the opposite of the truth.
          The free-night count carries the actionable side. */}
      {forwardOccupancy.length > 0 &&
      <div className="mb-6">
        <div className="flex items-baseline justify-between pb-2">
          <div className="text-[12px] font-semibold uppercase tracking-[0.5px] text-[#B0B0B0]">
            Booked
          </div>
          <div className="text-[11px] text-[#B0B0B0]">next {forwardOccupancy.length} months</div>
        </div>
        <div className="bg-white rounded-[12px] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)]">
          {forwardOccupancy.map((m, idx) =>
          <div
            key={m.month}
            title={`${m.nightsBooked} of ${m.nightsAvailable} nights booked · ${m.revenue}`}
            className={`flex items-center gap-3 ${idx > 0 ? 'mt-2.5' : ''}`}>
            <div className="w-[68px] shrink-0 text-[13px] text-[#717171] truncate">
              {m.label}
            </div>
            <div className="flex-1 h-[8px] bg-[#F0F0F0] rounded-full overflow-hidden">
              {/* A booked month is teal; nothing sold yet stays empty
                  rather than shouting, since a quiet month can be
                  deliberate. */}
              <div
                className="h-full bg-[#00A699] rounded-full transition-all"
                style={{ width: `${m.occupancyRate}%` }} />
            </div>
            <div className="w-[34px] shrink-0 text-right text-[12px] font-medium text-[#222222] tabular-nums">
              {m.occupancyRate}%
            </div>
            <div className={`w-[86px] shrink-0 text-right text-[12px] tabular-nums ${m.occupancyRate === 0 ? 'text-[#E8913A] font-medium' : 'text-[#B0B0B0]'}`}>
              {m.nightsAvailable - m.nightsBooked} nights free
            </div>
          </div>
          )}
        </div>
      </div>
      }

      </div>{/* end left column */}
      <div className="lg:col-span-1">

      {/* Upcoming — check-ins, check-outs and cleanings merged chronologically */}
      <div className="mb-6">
        <div className="text-[12px] font-semibold uppercase tracking-[0.5px] text-[#B0B0B0] pb-2">
          Upcoming
        </div>
        {agenda.length > 0 ?
        <div className="bg-white rounded-[12px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] overflow-hidden">
          {agenda.map((item, idx) =>
          <div
            key={item.id}
            className={`flex items-center gap-3 p-3 px-4 min-h-[52px] ${idx > 0 ? 'border-t border-[#F0F0F0]' : ''}`}>

              <div
              className={`w-2 h-2 rounded-full shrink-0 ${item.type === 'in' ? 'bg-[#00A699]' : item.type === 'out' ? 'bg-[#E8913A]' : 'bg-[#007AFF]'}`}>
            </div>
              <div className="flex-1 min-w-0">
                <div className="text-[15px] font-medium text-[#222222] tracking-[-0.2px]">
                  {item.title}
                </div>
                <div className="text-[13px] text-[#717171] mt-[1px]">
                  {item.subtitle}
                </div>
              </div>
            </div>
          )}
        </div> :
        <div className="bg-white rounded-[12px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] px-4 py-3 text-[14px] text-[#717171]">
          Nothing scheduled in the next few days.
        </div>
        }
      </div>

      {/* Upcoming Holidays */}
      <div className="mb-6">
        <div className="text-[12px] font-semibold uppercase tracking-[0.5px] text-[#B0B0B0] pb-2">
          Upcoming Holidays
        </div>
        <div className="bg-white rounded-[12px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] overflow-hidden">
          {upcomingHolidays.map((holiday, idx) =>
          <div
            key={holiday.id}
            className={`flex items-center gap-3 p-3 px-4 min-h-[52px] active:bg-[#F7F7F7] cursor-pointer ${idx > 0 ? 'border-t border-[#F0F0F0]' : ''}`}>
            
              <div className="w-2 h-2 rounded-full shrink-0 bg-[#DDAD4F]"></div>
              <div className="flex-1 min-w-0">
                <div className="text-[15px] font-medium text-[#222222] tracking-[-0.2px]">
                  {holiday.title}
                </div>
                <div className="text-[13px] text-[#717171] mt-[1px]">
                  {holiday.subtitle}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Recent Cancellations */}
      {recentCancellations.length > 0 &&
      <div className="mb-6">
        <div className="text-[12px] font-semibold uppercase tracking-[0.5px] text-[#B0B0B0] pb-2">
          Recent Cancellations
        </div>
        <div className="bg-white rounded-[12px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] overflow-hidden">
          {recentCancellations.map((c, idx) =>
          <div
            key={c.id}
            className={`flex items-center gap-3 p-3 px-4 min-h-[52px] ${idx > 0 ? 'border-t border-[#F0F0F0]' : ''}`}>

              <div className="w-2 h-2 rounded-full shrink-0 bg-[#D93900]"></div>
              <div className="flex-1 min-w-0">
                <div className="text-[15px] font-medium text-[#222222] tracking-[-0.2px]">
                  {c.guestName} <span className="text-[13px] font-normal text-[#717171]">· {c.platform}</span>
                </div>
                <div className="text-[13px] text-[#717171] mt-[1px]">
                  {c.property} · {c.checkIn} – {c.checkOut}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <div className="text-right">
                  <span className="text-[11px] font-semibold px-2 py-[3px] rounded-[6px] bg-[#FEF2F2] text-[#DC2626]">
                    Cancelled
                  </span>
                  {c.cancelledDate &&
                  <div className="text-[11px] text-[#B0B0B0] mt-1">{c.cancelledDate}</div>
                  }
                </div>
                <button
                onClick={() => dismissDashboardItem(c.key, 'forever')}
                aria-label="Dismiss"
                className="w-7 h-7 rounded-full flex items-center justify-center text-[#B0B0B0] hover:text-[#222222] hover:bg-[#F7F7F7] transition-colors">
                  <X className="w-4 h-4" strokeWidth={2} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      }
      </div>{/* end right column */}
      </div>{/* end 2-column grid */}

      {/* Performance. Last, and smaller: these numbers describe what has
          already happened and cannot change today's decisions. */}
      {kpis.length > 0 &&
      <div>
        <div className="text-[12px] font-semibold uppercase tracking-[0.5px] text-[#B0B0B0] pb-2">
          Performance
        </div>
        <div className="bg-white rounded-[12px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] grid grid-cols-2 lg:grid-cols-4 divide-x divide-y lg:divide-y-0 divide-[#F0F0F0]">
          {kpis.map((kpi, idx) =>
          <div key={idx} className="p-3 min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-[0.3px] text-[#B0B0B0] truncate">
              {kpi.label}
            </div>
            <div className="text-[17px] font-bold tracking-[-0.3px] text-[#222222] truncate mt-0.5">
              {kpi.value}
            </div>
            <div className="flex items-baseline gap-1.5 flex-wrap">
              {kpi.subvalue &&
              <span className="text-[11px] text-[#717171]">{kpi.subvalue}</span>
              }
              {kpi.trend &&
              <span className={`text-[11px] font-medium ${kpi.isPositive ? 'text-[#00A699]' : 'text-[#D93900]'}`}>
                {kpi.trend}
              </span>
              }
            </div>
            <div className="text-[10px] text-[#B0B0B0] mt-0.5 truncate">
              {kpi.period}
            </div>
          </div>
          )}
        </div>
      </div>
      }
    </div>);

}