import React from 'react';
import { X } from 'lucide-react';
import {
  kpis,
  needsAttention,
  currentlyStaying,
  nextUp,
  cleaningJobs,
  upcomingHolidays,
  recentCancellations,
  dismissDashboardItem } from
'../data/dashboard';
export function DashboardPage() {
  return (
    <div className="p-4 bg-[#F7F7F7] min-h-full">
      {/* KPIs */}
      <div className="flex gap-2 mb-6">
        {kpis.map((kpi, idx) =>
        <div
          key={idx}
          className="flex-1 bg-white rounded-[10px] p-3 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] min-w-0">

            <div className="text-[11px] font-semibold uppercase tracking-[0.3px] text-[#B0B0B0] mb-1">
              {kpi.label}
            </div>
            <div className="text-[20px] font-bold tracking-[-0.3px] text-[#222222] truncate">
              {kpi.value}
            </div>
            {kpi.trend &&
            <div
            className={`text-[11px] font-medium mt-0.5 ${kpi.isPositive ? 'text-[#00A699]' : 'text-[#D93900]'}`}>
              {kpi.trend}
            </div>
            }
            <div className="text-[10px] text-[#B0B0B0] mt-0.5">
              {kpi.period}
            </div>
          </div>
        )}
      </div>

      {/* Desktop: 2-column layout (left: attention + staying, right: the rest). Mobile: single column. */}
      <div className="lg:grid lg:grid-cols-3 lg:gap-6 lg:items-start">
      <div className="lg:col-span-2">

      {/* Needs Attention */}
      <div className="mb-6">
        <div className="text-[12px] font-semibold uppercase tracking-[0.5px] text-[#B0B0B0] pb-2">
          Needs Attention
        </div>
        <div className="bg-white rounded-[12px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] overflow-hidden">
          {needsAttention.map((item, idx) =>
          <div
            key={item.id}
            className={`flex items-center gap-3 p-3 px-4 min-h-[52px] active:bg-[#F7F7F7] cursor-pointer ${idx > 0 ? 'border-t border-[#F0F0F0]' : ''}`}>
            
              <div
              className={`w-2 h-2 rounded-full shrink-0 ${item.dotColor}`}>
            </div>
              <div className="flex-1 min-w-0">
                <div className="text-[15px] font-medium text-[#222222] tracking-[-0.2px]">
                  {item.title}
                </div>
                <div className="text-[13px] text-[#717171] mt-[1px]">
                  {item.subtitle}
                </div>
              </div>
              <button
              onClick={() => dismissDashboardItem(item.key, 'day')}
              aria-label="Dismiss"
              className="w-7 h-7 rounded-full flex items-center justify-center text-[#B0B0B0] hover:text-[#222222] hover:bg-[#F7F7F7] shrink-0 transition-colors">
                <X className="w-4 h-4" strokeWidth={2} />
              </button>

            </div>
          )}
        </div>
      </div>

      {/* Currently Staying */}
      <div className="mb-6">
        <div className="text-[12px] font-semibold uppercase tracking-[0.5px] text-[#B0B0B0] pb-2">
          Currently Staying
        </div>
        <div className="flex flex-col gap-2">
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

      </div>{/* end left column */}
      <div className="lg:col-span-1">

      {/* Next Up */}
      <div className="mb-6">
        <div className="text-[12px] font-semibold uppercase tracking-[0.5px] text-[#B0B0B0] pb-2">
          Next Up
        </div>
        <div className="flex flex-col">
          {nextUp.map((item) =>
          <div key={item.id} className="flex gap-3">
              <div className="flex flex-col items-center w-3 pt-1.5">
                <div
                className={`w-2 h-2 rounded-full shrink-0 ${item.type === 'in' ? 'bg-[#00A699]' : 'bg-[#E8913A]'}`}>
              </div>
                {!item.isLast &&
              <div className="w-[1px] flex-1 bg-[#EBEBEB] mt-1"></div>
              }
              </div>
              <div className="flex-1 pb-4">
                <div
                className={`text-[12px] font-semibold tracking-[0.2px] mb-[2px] ${item.type === 'in' ? 'text-[#00A699]' : 'text-[#E8913A]'}`}>
                
                  {item.label}
                </div>
                <div className="text-[16px] font-medium tracking-[-0.2px]">
                  {item.name}
                </div>
                <div className="text-[13px] text-[#717171] mt-[1px]">
                  {item.detail}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Cleaning Jobs */}
      <div className="mb-6">
        <div className="text-[12px] font-semibold uppercase tracking-[0.5px] text-[#B0B0B0] pb-2">
          Cleaning · Next 7 Days
        </div>
        <div className="bg-white rounded-[12px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] overflow-hidden">
          {cleaningJobs.map((job, idx) =>
          <div
            key={job.id}
            className={`flex items-center gap-3 p-3 px-4 min-h-[52px] active:bg-[#F7F7F7] cursor-pointer ${idx > 0 ? 'border-t border-[#F0F0F0]' : ''}`}>
            
              <div
              className={`w-2 h-2 rounded-full shrink-0 ${job.status === 'warn' ? 'bg-[#D93900]' : 'bg-[#00A699]'}`}>
            </div>
              <div className="flex-1 min-w-0">
                <div
                className={`text-[15px] font-medium tracking-[-0.2px] ${job.isProblem ? 'text-[#D93900]' : 'text-[#222222]'}`}>
                
                  {job.title}
                </div>
                <div className="text-[13px] text-[#717171] mt-[1px]">
                  {job.subtitle}
                </div>
              </div>
              <button
              className={`text-[14px] font-semibold px-3 py-2 rounded-[8px] shrink-0 bg-transparent border-none ${job.status === 'warn' ? 'text-[#007AFF] active:bg-[#F0F6FF]' : 'text-[#00A699] active:bg-[#F0FAF9]'}`}>
              
                {job.buttonText}
              </button>
            </div>
          )}
        </div>
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
    </div>);

}