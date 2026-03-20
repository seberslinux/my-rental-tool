import React from 'react';
import { Sparkles, BarChart2 } from 'lucide-react';
interface PlaceholderPageProps {
  type: 'cleaners' | 'analytics';
}
export function PlaceholderPage({ type }: PlaceholderPageProps) {
  const isCleaners = type === 'cleaners';
  const Icon = isCleaners ? Sparkles : BarChart2;
  const title = isCleaners ? 'Cleaners' : 'Analytics';
  const description = isCleaners ?
  'Manage your cleaning team and schedules' :
  'Occupancy, revenue, and performance data';
  return (
    <div className="p-4 bg-[#F7F7F7] min-h-full flex flex-col items-center justify-center pb-32">
      <div className="text-center text-[#717171]">
        <Icon
          className="w-10 h-10 text-[#B0B0B0] mx-auto mb-3"
          strokeWidth={1.5} />
        
        <h3 className="text-[18px] font-semibold text-[#222222] mb-1">
          {title}
        </h3>
        <p className="text-[14px]">{description}</p>
      </div>
    </div>);

}