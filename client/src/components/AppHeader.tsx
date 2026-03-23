import React, { useState } from 'react';
import { RefreshCw, Bell, ChevronDown } from 'lucide-react';
interface AppHeaderProps {
  title: string;
  propertyFilter?: {
    properties: { id: number; name: string }[];
    selected: number;
    onChange: (id: number) => void;
  };
  onRefresh?: () => Promise<void>;
}
export function AppHeader({ title, propertyFilter, onRefresh }: AppHeaderProps) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const handleRefresh = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      if (onRefresh) await onRefresh();
    } finally {
      setIsRefreshing(false);
    }
  };
  return (
    <div className="bg-white px-4 py-3 border-b border-[#EBEBEB] sticky top-0 z-20">
      <div className="flex items-center justify-between">
        <h1 className="text-[28px] font-bold tracking-[-0.5px] text-[#222222]">
          {title}
        </h1>
        <div className="flex gap-2">
          <button
            onClick={handleRefresh}
            className="w-9 h-9 rounded-full border border-[#EBEBEB] bg-white flex items-center justify-center text-[#222222] active:bg-[#F7F7F7] transition-colors">

            <RefreshCw
              className={`w-[18px] h-[18px] ${isRefreshing ? 'animate-spin' : ''}`}
              strokeWidth={1.5} />

          </button>
          <button className="w-9 h-9 rounded-full border border-[#EBEBEB] bg-white flex items-center justify-center text-[#222222] active:bg-[#F7F7F7] transition-colors relative">
            <Bell className="w-[18px] h-[18px]" strokeWidth={1.5} />
            <span className="absolute top-[-1px] right-[-1px] w-2 h-2 rounded-full bg-[#D93900] border-2 border-white"></span>
          </button>
        </div>
      </div>
      {propertyFilter && (
        <div className="mt-2 relative">
          <select
            value={propertyFilter.selected}
            onChange={(e) => propertyFilter.onChange(Number(e.target.value))}
            className="appearance-none w-full bg-[#F7F7F7] text-[14px] font-medium text-[#222222] rounded-[8px] px-3 py-2 pr-8 border border-[#EBEBEB] cursor-pointer focus:outline-none focus:ring-1 focus:ring-[#222222]">
            <option value={0}>All Properties</option>
            {propertyFilter.properties.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#717171] pointer-events-none" strokeWidth={2} />
        </div>
      )}
      <div className="text-[13px] text-[#B0B0B0] mt-1 flex items-center gap-1">
        <span className="w-[5px] h-[5px] rounded-full bg-[#00A699]"></span>
        Synced 2 min ago
      </div>
    </div>);

}