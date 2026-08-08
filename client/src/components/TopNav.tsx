import React, { useState } from 'react';
import {
  Home,
  Calendar,
  Sparkles,
  BarChart2,
  MoreHorizontal,
  RefreshCw,
  Bell,
  User,
  ChevronDown } from
'lucide-react';

interface TopNavProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  onRefresh?: () => Promise<void>;
  hasNotifications?: boolean;
  onOpenNotifications?: () => void;
  syncedLabel?: string;
  propertyFilter?: {
    properties: { id: number; name: string }[];
    selected: number;
    onChange: (id: number) => void;
  };
}

// Desktop-only top navigation (hidden below lg). Mirrors the mobile TabBar's tabs.
export function TopNav({ activeTab, onTabChange, onRefresh, hasNotifications, onOpenNotifications, syncedLabel, propertyFilter }: TopNavProps) {
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

  const tabs = [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'calendar', label: 'Calendar', icon: Calendar },
    { id: 'cleaners', label: 'Cleaners', icon: Sparkles },
    { id: 'analytics', label: 'Analytics', icon: BarChart2 },
    { id: 'more', label: 'More', icon: MoreHorizontal }];

  return (
    <header className="hidden lg:flex sticky top-0 z-30 h-16 bg-white border-b border-[#EBEBEB] items-center justify-between px-10">
      {/* Brand + nav links */}
      <div className="flex items-center gap-8">
        <button
          onClick={() => onTabChange('home')}
          className="flex items-center gap-2 text-[#FF385C] focus:outline-none">
          <Home className="w-6 h-6" strokeWidth={2} />
          <span className="text-[18px] font-bold tracking-[-0.3px]">My Rentals</span>
        </button>
        <nav className="flex items-center gap-1">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                className={`px-3 py-2 rounded-full text-[14px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FF385C66] ${
                isActive ?
                'text-[#FF385C] bg-[#FF385C0F]' :
                'text-[#717171] hover:text-[#222222] hover:bg-[#F7F7F7]'}`}>

                {tab.label}
              </button>);

          })}
        </nav>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        {syncedLabel &&
        <div className="hidden xl:flex items-center gap-1 text-[13px] text-[#B0B0B0] mr-1">
          <span className="w-[5px] h-[5px] rounded-full bg-[#00A699]"></span>
          {syncedLabel}
        </div>
        }
        {propertyFilter &&
        <div className="relative mr-1">
          <select
            value={propertyFilter.selected}
            onChange={(e) => propertyFilter.onChange(Number(e.target.value))}
            className="appearance-none bg-[#F7F7F7] text-[14px] font-medium text-[#222222] rounded-[8px] pl-3 pr-8 py-2 border border-[#EBEBEB] cursor-pointer hover:bg-[#F0F0F0] focus:outline-none focus:ring-1 focus:ring-[#222222]">
            <option value={0}>All Properties</option>
            {propertyFilter.properties.map((p) =>
            <option key={p.id} value={p.id}>{p.name}</option>
            )}
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#717171] pointer-events-none" strokeWidth={2} />
        </div>
        }
        <button
          onClick={handleRefresh}
          className="w-9 h-9 rounded-full border border-[#EBEBEB] bg-white flex items-center justify-center text-[#222222] hover:bg-[#F7F7F7] transition-colors">
          <RefreshCw
            className={`w-[18px] h-[18px] ${isRefreshing ? 'animate-spin' : ''}`}
            strokeWidth={1.5} />
        </button>
        <button
          onClick={onOpenNotifications}
          aria-label="Notifications"
          className="w-9 h-9 rounded-full border border-[#EBEBEB] bg-white flex items-center justify-center text-[#222222] hover:bg-[#F7F7F7] transition-colors relative">
          <Bell className="w-[18px] h-[18px]" strokeWidth={1.5} />
          {hasNotifications &&
          <span className="absolute top-[-1px] right-[-1px] w-2 h-2 rounded-full bg-[#D93900] border-2 border-white"></span>
          }
        </button>
        <button
          onClick={() => onTabChange('more')}
          className="w-9 h-9 rounded-full border border-[#EBEBEB] bg-white flex items-center justify-center text-[#222222] hover:bg-[#F7F7F7] transition-colors">
          <User className="w-[18px] h-[18px]" strokeWidth={1.5} />
        </button>
      </div>
    </header>);

}
