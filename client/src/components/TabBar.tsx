import React from 'react';
import {
  Home,
  Calendar,
  BrushCleaning,
  BarChart2,
  MoreHorizontal } from
'lucide-react';
interface TabBarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  homeBadge?: number;
}
export function TabBar({ activeTab, onTabChange, homeBadge = 0 }: TabBarProps) {
  const tabs = [
  {
    id: 'home',
    label: 'Home',
    icon: Home,
    badge: homeBadge
  },
  {
    id: 'calendar',
    label: 'Calendar',
    icon: Calendar
  },
  {
    id: 'cleaners',
    label: 'Cleaners',
    // Was Sparkles, which has become the universal "AI" glyph — on a nav
    // bar it reads as an assistant feature rather than as the people who
    // clean the flats. It was also the only non-literal icon in a row of
    // a house, a calendar and a bar chart.
    icon: BrushCleaning
  },
  {
    id: 'analytics',
    label: 'Analytics',
    icon: BarChart2
  },
  {
    id: 'more',
    label: 'More',
    icon: MoreHorizontal
  }];

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 h-[64px] pb-safe bg-white border-t border-[#EBEBEB] flex justify-around z-50">
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        const Icon = tab.icon;
        return (
          <a
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`flex flex-col items-center justify-center gap-1 cursor-pointer flex-1 pt-2 relative transition-colors ${isActive ? 'text-[#FF385C]' : 'text-[#717171] hover:text-[#222222]'}`}>
            
            <Icon
              className="w-[22px] h-[22px]"
              strokeWidth={isActive ? 2 : 1.5} />
            
            <span className="text-[10px]">{tab.label}</span>
            {(tab.badge ?? 0) > 0 &&
            <span className="absolute top-[6px] left-[calc(50%+5px)] bg-[#D93900] text-white text-[10px] font-bold min-w-[16px] h-[16px] rounded-full flex items-center justify-center px-1 border-2 border-white leading-none">
                {tab.badge}
              </span>
            }
          </a>);

      })}
    </nav>);

}