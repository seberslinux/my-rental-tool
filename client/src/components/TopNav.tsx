import React, { useState } from 'react';
import {
  Home,
  Calendar,
  Sparkles,
  BarChart2,
  MoreHorizontal,
  RefreshCw,
  Bell,
  User } from
'lucide-react';

interface TopNavProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  onRefresh?: () => Promise<void>;
  hasNotifications?: boolean;
}

// Desktop-only top navigation (hidden below lg). Mirrors the mobile TabBar's tabs.
export function TopNav({ activeTab, onTabChange, onRefresh, hasNotifications }: TopNavProps) {
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
          className="flex items-center gap-2 text-[#FF385C]">
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
                className={`px-3 py-2 rounded-full text-[14px] font-medium transition-colors ${
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
        <button
          onClick={handleRefresh}
          className="w-9 h-9 rounded-full border border-[#EBEBEB] bg-white flex items-center justify-center text-[#222222] hover:bg-[#F7F7F7] transition-colors">
          <RefreshCw
            className={`w-[18px] h-[18px] ${isRefreshing ? 'animate-spin' : ''}`}
            strokeWidth={1.5} />
        </button>
        <button className="w-9 h-9 rounded-full border border-[#EBEBEB] bg-white flex items-center justify-center text-[#222222] hover:bg-[#F7F7F7] transition-colors relative">
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
