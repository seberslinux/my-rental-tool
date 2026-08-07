import React from 'react';
import { ChevronDown } from 'lucide-react';
import { properties } from '../data/properties';
interface CalendarHeaderProps {
  mode: 'single' | 'multi';
  setMode: (mode: 'single' | 'multi') => void;
  propertyId: number;
  setPropertyId: (id: number) => void;
  channelFilter: string;
  setChannelFilter: (filter: string) => void;
}
export function CalendarHeader({
  mode,
  setMode,
  propertyId,
  setPropertyId,
  channelFilter,
  setChannelFilter
}: CalendarHeaderProps) {
  return (
    <header className="sticky top-0 z-20 bg-white shadow-[0_1px_0_rgba(0,0,0,0.04)]">
      <div className="flex justify-between items-center p-3 px-4">
        <div className="flex-1 relative">
          {mode === 'single' &&
          <div className="relative inline-flex items-center">
              <select
              value={propertyId}
              onChange={(e) => setPropertyId(Number(e.target.value))}
              className="appearance-none border-none text-[16px] font-semibold text-[#222222] bg-transparent cursor-pointer p-0 pr-5 focus:ring-0 outline-none">
              
                {properties.map((p) =>
              <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
              )}
              </select>
              <ChevronDown
              className="w-4 h-4 text-[#222222] absolute right-0 pointer-events-none"
              strokeWidth={2.5} />
            
            </div>
          }
        </div>

        <div className="flex items-center gap-3">
          <select
            value={channelFilter}
            onChange={(e) => setChannelFilter(e.target.value)}
            className="appearance-none text-[11px] font-medium py-1.5 px-3 border border-[#DDDDDD] rounded-full bg-white text-[#222222] cursor-pointer outline-none focus:ring-2 focus:ring-black/5">
            
            <option value="all">All channels</option>
            <option value="airbnb">Airbnb</option>
            <option value="bcom">Booking.com</option>
            <option value="direct">Direct</option>
            <option value="blocked">Blocked</option>
          </select>

          <div className="inline-flex bg-[#F7F7F7] rounded-full p-0.5">
            <button
              onClick={() => setMode('single')}
              className={`px-3.5 py-1.5 text-[11px] font-medium rounded-full transition-all ${mode === 'single' ? 'bg-white text-[#222222] shadow-[0_1px_3px_rgba(0,0,0,0.08)]' : 'text-[#717171] hover:text-[#222222]'}`}>
              
              Single
            </button>
            <button
              onClick={() => setMode('multi')}
              className={`px-3.5 py-1.5 text-[11px] font-medium rounded-full transition-all ${mode === 'multi' ? 'bg-white text-[#222222] shadow-[0_1px_3px_rgba(0,0,0,0.08)]' : 'text-[#717171] hover:text-[#222222]'}`}>
              
              Multi
            </button>
          </div>
        </div>
      </div>

      {/* The weekday row lives in MonthCalendar, directly above the grid
          it labels — here it sat above the month paging instead. */}
    </header>);

}