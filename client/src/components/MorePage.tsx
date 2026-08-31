import React from 'react';
import { NotificationSetting } from './NotificationSetting';
import {
  ChevronRight,
  Home,
  DollarSign,
  Wrench,
  Star,
  Users,
  Settings,
  LogOut,
  TrendingUp,
  Wifi } from
'lucide-react';
interface MorePageProps {
  onNavigate?: (tab: string) => void;
  onLogout?: () => void;
}
export function MorePage({ onNavigate, onLogout }: MorePageProps) {
  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    } catch {}
    if (onLogout) onLogout();
    else window.location.reload();
  };
  return (
    <div className="p-4 bg-[#F7F7F7] min-h-full">
      {/* Being told, before anything else here. It is the one setting
          that changes whether the app reaches you when it is shut. */}
      <div className="mb-6">
        <div className="text-[12px] font-semibold uppercase tracking-[0.5px] text-[#B0B0B0] pb-2">
          Alerts
        </div>
        <NotificationSetting />
      </div>

      {/* Manage Section */}
      <div className="mb-6">
        <div className="text-[12px] font-semibold uppercase tracking-[0.5px] text-[#B0B0B0] pb-2">
          Manage
        </div>
        <div className="bg-white rounded-[12px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] overflow-hidden">
          <div
            className="flex items-center gap-3 p-3 px-4 min-h-[48px] active:bg-[#F7F7F7] cursor-pointer"
            onClick={() => onNavigate && onNavigate('properties')}>
            
            <div className="w-[30px] h-[30px] rounded-[7px] bg-[#007AFF] flex items-center justify-center shrink-0 text-white">
              <Home className="w-4 h-4" strokeWidth={2} />
            </div>
            <div className="flex-1 text-[16px] font-normal text-[#222222]">
              Properties
            </div>
            <ChevronRight
              className="w-3.5 h-3.5 text-[#B0B0B0] shrink-0"
              strokeWidth={2} />
            
          </div>

          {/* Rates sits above Finances rather than replacing it: that row
              is a placeholder for a page the backend already has routes
              for, and quietly renaming it would lose it. */}
          <div
            className="flex items-center gap-3 p-3 px-4 min-h-[48px] active:bg-[#F7F7F7] cursor-pointer border-t border-[#F0F0F0]"
            onClick={() => onNavigate && onNavigate('rates')}>
            <div className="w-[30px] h-[30px] rounded-[7px] bg-[#0F6E56] flex items-center justify-center shrink-0 text-white">
              <TrendingUp className="w-4 h-4" strokeWidth={2} />
            </div>
            <div className="flex-1 text-[16px] font-normal text-[#222222]">
              Rates
            </div>
            <ChevronRight className="w-3.5 h-3.5 text-[#B0B0B0] shrink-0" strokeWidth={2} />
          </div>

          <div className="flex items-center gap-3 p-3 px-4 min-h-[48px] active:bg-[#F7F7F7] cursor-pointer border-t border-[#F0F0F0]">
            <div className="w-[30px] h-[30px] rounded-[7px] bg-[#00A699] flex items-center justify-center shrink-0 text-white">
              <DollarSign className="w-4 h-4" strokeWidth={2} />
            </div>
            <div className="flex-1 text-[16px] font-normal text-[#222222]">
              Finances
            </div>
            <ChevronRight
              className="w-3.5 h-3.5 text-[#B0B0B0] shrink-0"
              strokeWidth={2} />
            
          </div>

          {/* Was "Maintenance", and did nothing when tapped. The page it
              now opens covers faults, notes and supplies — everything a
              cleaner has said — so it is named for that rather than for
              the one table it started as. */}
          <div
            className="flex items-center gap-3 p-3 px-4 min-h-[48px] active:bg-[#F7F7F7] cursor-pointer border-t border-[#F0F0F0]"
            onClick={() => onNavigate && onNavigate('todo')}>
            <div className="w-[30px] h-[30px] rounded-[7px] bg-[#E8913A] flex items-center justify-center shrink-0 text-white">
              <Wrench className="w-4 h-4" strokeWidth={2} />
            </div>
            <div className="flex-1 text-[16px] font-normal text-[#222222]">
              To do
            </div>
            <ChevronRight
              className="w-3.5 h-3.5 text-[#B0B0B0] shrink-0"
              strokeWidth={2} />
            
          </div>

          <div className="flex items-center gap-3 p-3 px-4 min-h-[48px] active:bg-[#F7F7F7] cursor-pointer border-t border-[#F0F0F0]">
            <div className="w-[30px] h-[30px] rounded-[7px] bg-[#DDAD4F] flex items-center justify-center shrink-0 text-white">
              <Star className="w-4 h-4" strokeWidth={2} />
            </div>
            <div className="flex-1 text-[16px] font-normal text-[#222222]">
              Reviews
            </div>
            <ChevronRight
              className="w-3.5 h-3.5 text-[#B0B0B0] shrink-0"
              strokeWidth={2} />
            
          </div>
        </div>
      </div>

      {/* Account Section */}
      <div className="mb-6">
        <div className="text-[12px] font-semibold uppercase tracking-[0.5px] text-[#B0B0B0] pb-2">
          Account
        </div>
        <div className="bg-white rounded-[12px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] overflow-hidden">
          <div
            className="flex items-center gap-3 p-3 px-4 min-h-[48px] active:bg-[#F7F7F7] cursor-pointer"
            onClick={() => onNavigate && onNavigate('smoobu')}>
            <div className="w-[30px] h-[30px] rounded-[7px] bg-[#FF385C] flex items-center justify-center shrink-0 text-white">
              <Wifi className="w-4 h-4" strokeWidth={2} />
            </div>
            <div className="flex-1 text-[16px] font-normal text-[#222222]">
              Smoobu Connection
            </div>
            <ChevronRight
              className="w-3.5 h-3.5 text-[#B0B0B0] shrink-0"
              strokeWidth={2} />
          </div>

          <div
            className="flex items-center gap-3 p-3 px-4 min-h-[48px] active:bg-[#F7F7F7] cursor-pointer border-t border-[#F0F0F0]"
            onClick={() => onNavigate && onNavigate('users')}>
            <div className="w-[30px] h-[30px] rounded-[7px] bg-[#6B7B8D] flex items-center justify-center shrink-0 text-white">
              <Users className="w-4 h-4" strokeWidth={2} />
            </div>
            <div className="flex-1 text-[16px] font-normal text-[#222222]">
              Users
            </div>
            <ChevronRight
              className="w-3.5 h-3.5 text-[#B0B0B0] shrink-0"
              strokeWidth={2} />

          </div>

          <div className="flex items-center gap-3 p-3 px-4 min-h-[48px] active:bg-[#F7F7F7] cursor-pointer border-t border-[#F0F0F0]">
            <div className="w-[30px] h-[30px] rounded-[7px] bg-[#999999] flex items-center justify-center shrink-0 text-white">
              <Settings className="w-4 h-4" strokeWidth={2} />
            </div>
            <div className="flex-1 text-[16px] font-normal text-[#222222]">
              Settings
            </div>
            <ChevronRight
              className="w-3.5 h-3.5 text-[#B0B0B0] shrink-0"
              strokeWidth={2} />

          </div>

          <div
            className="flex items-center gap-3 p-3 px-4 min-h-[48px] active:bg-[#F7F7F7] cursor-pointer border-t border-[#F0F0F0]"
            onClick={handleLogout}>
            <div className="w-[30px] h-[30px] rounded-[7px] bg-[#DC2626] flex items-center justify-center shrink-0 text-white">
              <LogOut className="w-4 h-4" strokeWidth={2} />
            </div>
            <div className="flex-1 text-[16px] font-normal text-[#DC2626]">
              Sign Out
            </div>
          </div>
        </div>
      </div>
    </div>);

}