import React, { useState } from 'react';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Info,
  Calendar as CalendarIcon,
  Plus,
  X,
  Check } from
'lucide-react';
export function CleanersPage() {
  const [selectedMonth, setSelectedMonth] = useState('March 2026');
  const [showAddForm, setShowAddForm] = useState(false);
  const [weekOffset, setWeekOffset] = useState(0);
  // Mock data for a 7-day grid
  const days = [
  {
    date: '16',
    day: 'MON',
    active: false
  },
  {
    date: '17',
    day: 'TUE',
    active: false
  },
  {
    date: '18',
    day: 'WED',
    active: false
  },
  {
    date: '19',
    day: 'THU',
    active: true
  },
  {
    date: '20',
    day: 'FRI',
    active: false
  },
  {
    date: '21',
    day: 'SAT',
    active: false
  },
  {
    date: '22',
    day: 'SUN',
    active: false
  }];

  const janeAvailability = [true, true, true, true, false, false, false];
  const coverage = [1, 1, 1, 1, 0, 0, 0];
  return (
    <div className="p-4 md:p-6 max-w-[1200px] mx-auto space-y-4 md:space-y-6 pb-24">
      {/* Alert Banner */}
      <div className="bg-[#FEF2F2] border border-[#FCA5A5] rounded-[8px] p-3 md:p-4 flex items-start gap-3">
        <AlertTriangle
          className="w-5 h-5 text-[#DC2626] flex-shrink-0 mt-0.5"
          strokeWidth={2} />
        
        <p className="text-[13px] md:text-[14px] text-[#991B1B] leading-relaxed">
          <span className="font-semibold">
            No cleaner available on Fri 20 Mar, Sat 21 Mar, Sun 22 Mar, Fri 27
            Mar, Sat 28 Mar, Sun 29 Mar.
          </span>{' '}
          Consider finding backup coverage.
        </p>
      </div>

      {/* Combined Availability & Jobs */}
      <div className="bg-white rounded-[12px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] border border-[#EBEBEB] overflow-hidden">
        <div className="p-4 md:p-5 border-b border-[#EBEBEB] flex flex-col sm:flex-row sm:items-center justify-between gap-3 md:gap-4">
          <h2 className="text-[15px] md:text-[16px] font-semibold text-[#222222]">
            Combined Availability & Jobs
          </h2>
          <div className="flex items-center justify-between sm:justify-end gap-2 w-full sm:w-auto">
            <div className="flex items-center gap-1 md:gap-2">
              <button
                onClick={() => setWeekOffset(weekOffset - 1)}
                className="w-8 h-8 flex items-center justify-center rounded-[6px] border border-[#EBEBEB] hover:bg-[#F7F7F7] text-[#717171]">
                
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-[13px] md:text-[14px] font-medium text-[#222222] min-w-[120px] md:min-w-[140px] text-center">
                16 Mar – 22 Mar
              </span>
              <button
                onClick={() => setWeekOffset(weekOffset + 1)}
                className="w-8 h-8 flex items-center justify-center rounded-[6px] border border-[#EBEBEB] hover:bg-[#F7F7F7] text-[#717171]">
                
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
            <button
              onClick={() => setWeekOffset(0)}
              className="px-3 py-1.5 text-[12px] md:text-[13px] font-medium border border-[#EBEBEB] rounded-[6px] hover:bg-[#F7F7F7] text-[#222222]">
              
              Today
            </button>
          </div>
        </div>
        <div className="p-4 md:p-5 overflow-x-auto">
          <div className="min-w-[500px]">
            {/* Header Row */}
            <div className="flex mb-2">
              <div className="w-[80px] md:w-[120px] flex-shrink-0"></div>
              <div className="flex-1 grid grid-cols-7 gap-1">
                {days.map((d, i) =>
                <div
                  key={i}
                  className={`text-center pb-2 ${d.active ? 'border-b-2 border-[#007AFF]' : ''}`}>
                  
                    <div
                    className={`text-[10px] md:text-[11px] font-medium ${d.active ? 'text-[#007AFF]' : 'text-[#717171]'}`}>
                    
                      {d.day} {d.date}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Jane Row */}
            <div className="flex items-center py-2 border-b border-[#F0F0F0]">
              <div className="w-[80px] md:w-[120px] flex-shrink-0 flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-[#8B5CF6]"></div>
                <span className="text-[13px] md:text-[14px] text-[#222222] truncate">
                  Jane
                </span>
              </div>
              <div className="flex-1 grid grid-cols-7 gap-1">
                {janeAvailability.map((isAvail, i) =>
                <div key={i} className="flex justify-center items-center">
                    {isAvail ?
                  <div className="w-full max-w-[40px] h-7 md:h-8 bg-[#ECFDF5] rounded-[4px] flex items-center justify-center">
                        <Check
                      className="w-3 h-3 md:w-4 md:h-4 text-[#10B981]"
                      strokeWidth={3} />
                    
                      </div> :

                  <div className="w-full max-w-[40px] h-7 md:h-8 bg-[#F7F7F7] rounded-[4px] flex items-center justify-center">
                        <span className="text-[#B0B0B0] text-[14px] md:text-[16px] leading-none">
                          -
                        </span>
                      </div>
                  }
                  </div>
                )}
              </div>
            </div>

            {/* Coverage Row */}
            <div className="flex items-center py-3">
              <div className="w-[80px] md:w-[120px] flex-shrink-0">
                <span className="text-[13px] md:text-[14px] font-medium text-[#222222]">
                  Coverage
                </span>
              </div>
              <div className="flex-1 grid grid-cols-7 gap-1">
                {coverage.map((count, i) =>
                <div key={i} className="flex justify-center items-center">
                    <div
                    className={`w-full max-w-[40px] h-7 md:h-8 rounded-[4px] flex items-center justify-center text-[12px] md:text-[13px] font-bold ${count > 0 ? 'bg-[#FFFBEB] text-[#D97706]' : 'bg-[#FEF2F2] text-[#DC2626]'}`}>
                    
                      {count}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Upcoming Jobs */}
      <div className="bg-white rounded-[12px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] border border-[#EBEBEB] overflow-hidden">
        <div className="p-4 md:p-5 border-b border-[#EBEBEB]">
          <h2 className="text-[15px] md:text-[16px] font-semibold text-[#222222]">
            Upcoming Jobs (Next 7 Days)
          </h2>
        </div>

        {/* Mobile Card Layout */}
        <div className="block sm:hidden p-6 text-center text-[13px] text-[#717171]">
          No upcoming jobs.
        </div>

        {/* Desktop Table Layout */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full text-left text-[12px]">
            <thead className="bg-[#F7F7F7] text-[#717171]">
              <tr>
                <th className="p-3 pl-5 font-semibold uppercase tracking-[0.3px] text-[10px]">
                  Date
                </th>
                <th className="p-3 font-semibold uppercase tracking-[0.3px] text-[10px]">
                  Time
                </th>
                <th className="p-3 font-semibold uppercase tracking-[0.3px] text-[10px]">
                  Property
                </th>
                <th className="p-3 font-semibold uppercase tracking-[0.3px] text-[10px]">
                  Type
                </th>
                <th className="p-3 font-semibold uppercase tracking-[0.3px] text-[10px]">
                  Cleaner
                </th>
                <th className="p-3 pr-5 font-semibold uppercase tracking-[0.3px] text-[10px]">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td
                  colSpan={6}
                  className="p-8 text-center text-[13px] text-[#717171]">
                  
                  No upcoming jobs.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Your Cleaners */}
      <div>
        <h2 className="text-[16px] md:text-[18px] font-semibold text-[#222222] mb-3 md:mb-4">
          Your Cleaners
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="bg-white rounded-[12px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] border border-[#EBEBEB] overflow-hidden">
            <div className="p-4 md:p-5 border-b border-[#F0F0F0] flex justify-between items-start">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-[#8B5CF6] flex items-center justify-center text-white font-semibold text-[16px]">
                  J
                </div>
                <div>
                  <div className="text-[14px] md:text-[15px] font-semibold text-[#222222]">
                    Jane
                  </div>
                  <div className="text-[12px] md:text-[13px] text-[#717171]">
                    +34435433243242
                  </div>
                </div>
              </div>
              <div className="bg-[#ECFDF5] text-[#10B981] px-2 py-1 rounded-[4px] text-[11px] md:text-[12px] font-semibold">
                R 400/hr
              </div>
            </div>
            <div className="p-4 md:p-5 space-y-4">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.3px] text-[#B0B0B0] mb-2">
                  Assigned Properties
                </div>
                <div className="flex flex-wrap gap-2">
                  <div className="inline-block bg-[#F0F9FF] text-[#007AFF] px-2.5 py-1 rounded-[4px] text-[11px] md:text-[12px] font-medium">
                    Hill Top Lodge
                  </div>
                </div>
              </div>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.3px] text-[#B0B0B0] mb-2">
                  Availability
                </div>
                <div className="flex gap-1.5">
                  {['M', 'T', 'W', 'T'].map((d, i) =>
                  <div
                    key={i}
                    className="w-6 h-6 md:w-7 md:h-7 rounded-full bg-[#007AFF] text-white flex items-center justify-center text-[10px] md:text-[11px] font-semibold">
                    
                      {d}
                    </div>
                  )}
                  {['F', 'S', 'S'].map((d, i) =>
                  <div
                    key={i + 4}
                    className="w-6 h-6 md:w-7 md:h-7 rounded-full bg-[#F0F0F0] text-[#B0B0B0] flex items-center justify-center text-[10px] md:text-[11px] font-semibold">
                    
                      {d}
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="p-3 md:p-4 bg-[#F7F7F7] border-t border-[#F0F0F0] flex justify-end gap-2">
              <button className="px-3 py-1.5 text-[12px] md:text-[13px] font-medium bg-white border border-[#EBEBEB] rounded-[6px] hover:bg-[#F0F0F0] text-[#222222]">
                Edit
              </button>
              <button className="px-3 py-1.5 text-[12px] md:text-[13px] font-medium bg-white border border-[#EBEBEB] rounded-[6px] hover:bg-[#F0F0F0] text-[#222222]">
                Schedule
              </button>
              <button className="px-3 py-1.5 text-[12px] md:text-[13px] font-medium bg-white border border-[#FCA5A5] rounded-[6px] hover:bg-[#FEF2F2] text-[#DC2626]">
                Remove
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Add New Cleaner */}
      <div>
        {!showAddForm ?
        <button
          onClick={() => setShowAddForm(true)}
          className="flex items-center gap-2 text-[#007AFF] font-semibold text-[14px] hover:underline">
          
            <Plus className="w-4 h-4" />
            Add New Cleaner
          </button> :

        <div className="bg-white rounded-[12px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] border border-[#EBEBEB] overflow-hidden">
            <div className="p-4 md:p-5 border-b border-[#EBEBEB] flex justify-between items-center bg-[#F7F7F7]">
              <h2 className="text-[15px] md:text-[16px] font-semibold text-[#222222]">
                Add New Cleaner
              </h2>
              <button
              onClick={() => setShowAddForm(false)}
              className="text-[#717171] hover:text-[#222222]">
              
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 md:p-6 space-y-5 md:space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-5">
                <div>
                  <label className="block text-[12px] md:text-[13px] font-medium text-[#222222] mb-1.5">
                    Name
                  </label>
                  <input
                  type="text"
                  placeholder="Full name"
                  className="w-full h-10 px-3 border border-[#EBEBEB] rounded-[8px] text-[13px] md:text-[14px] focus:outline-none focus:border-[#007AFF] focus:ring-1 focus:ring-[#007AFF]" />
                
                </div>
                <div>
                  <label className="block text-[12px] md:text-[13px] font-medium text-[#222222] mb-1.5">
                    Phone (WhatsApp)
                  </label>
                  <input
                  type="text"
                  placeholder="+27821234567"
                  className="w-full h-10 px-3 border border-[#EBEBEB] rounded-[8px] text-[13px] md:text-[14px] focus:outline-none focus:border-[#007AFF] focus:ring-1 focus:ring-[#007AFF]" />
                
                </div>
                <div>
                  <label className="block text-[12px] md:text-[13px] font-medium text-[#222222] mb-1.5">
                    PIN (4 digits)
                  </label>
                  <input
                  type="text"
                  placeholder="1234"
                  className="w-full h-10 px-3 border border-[#EBEBEB] rounded-[8px] text-[13px] md:text-[14px] focus:outline-none focus:border-[#007AFF] focus:ring-1 focus:ring-[#007AFF]" />
                
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-5">
                <div>
                  <label className="block text-[12px] md:text-[13px] font-medium text-[#222222] mb-1.5">
                    Rate (ZAR)
                  </label>
                  <input
                  type="text"
                  placeholder="0"
                  className="w-full h-10 px-3 border border-[#EBEBEB] rounded-[8px] text-[13px] md:text-[14px] focus:outline-none focus:border-[#007AFF] focus:ring-1 focus:ring-[#007AFF]" />
                
                </div>
                <div>
                  <label className="block text-[12px] md:text-[13px] font-medium text-[#222222] mb-1.5">
                    Rate Type
                  </label>
                  <select className="w-full h-10 px-3 border border-[#EBEBEB] rounded-[8px] text-[13px] md:text-[14px] focus:outline-none focus:border-[#007AFF] focus:ring-1 focus:ring-[#007AFF] bg-white">
                    <option>Hourly</option>
                    <option>Per Clean</option>
                    <option>Monthly</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[12px] md:text-[13px] font-medium text-[#222222] mb-1.5">
                    Email (optional)
                  </label>
                  <input
                  type="email"
                  placeholder="email@example.com"
                  className="w-full h-10 px-3 border border-[#EBEBEB] rounded-[8px] text-[13px] md:text-[14px] focus:outline-none focus:border-[#007AFF] focus:ring-1 focus:ring-[#007AFF]" />
                
                </div>
              </div>

              <div>
                <label className="block text-[12px] md:text-[13px] font-medium text-[#222222] mb-2">
                  Assign to Properties
                </label>
                <div className="space-y-2 border border-[#EBEBEB] rounded-[8px] p-3">
                  {[
                'Camps Bay Villa',
                'Green Point Apt',
                'Sea Point Studio'].
                map((prop) =>
                <label key={prop} className="flex items-center gap-2">
                      <input
                    type="checkbox"
                    className="w-4 h-4 rounded border-[#EBEBEB] text-[#007AFF] focus:ring-[#007AFF]" />
                  
                      <span className="text-[13px] md:text-[14px] text-[#222222]">
                        {prop}
                      </span>
                    </label>
                )}
                </div>
              </div>

              <div>
                <label className="block text-[12px] md:text-[13px] font-medium text-[#222222] mb-3">
                  Weekly Availability
                </label>
                {/* Mobile: Vertical List */}
                <div className="block md:hidden space-y-3">
                  {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(
                  (day) =>
                  <div
                    key={day}
                    className="flex items-center gap-3 bg-[#F7F7F7] p-2 rounded-[8px]">
                    
                        <div className="flex items-center gap-2 w-[70px]">
                          <input
                        type="checkbox"
                        className="w-4 h-4 rounded border-[#EBEBEB] text-[#007AFF] focus:ring-[#007AFF]" />
                      
                          <span className="text-[13px] font-medium text-[#222222]">
                            {day}
                          </span>
                        </div>
                        <div className="flex-1 flex items-center gap-2">
                          <div className="flex-1 flex items-center border border-[#EBEBEB] rounded-[6px] px-2 py-1 bg-white">
                            <input
                          type="text"
                          defaultValue="09:00"
                          className="w-full text-[12px] text-center focus:outline-none" />
                        
                          </div>
                          <span className="text-[12px] text-[#717171]">-</span>
                          <div className="flex-1 flex items-center border border-[#EBEBEB] rounded-[6px] px-2 py-1 bg-white">
                            <input
                          type="text"
                          defaultValue="17:00"
                          className="w-full text-[12px] text-center focus:outline-none" />
                        
                          </div>
                        </div>
                      </div>

                )}
                </div>

                {/* Desktop: Grid */}
                <div className="hidden md:grid grid-cols-7 gap-4">
                  {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(
                  (day) =>
                  <div
                    key={day}
                    className="flex flex-col items-center gap-2">
                    
                        <div className="flex items-center gap-2">
                          <input
                        type="checkbox"
                        className="w-4 h-4 rounded border-[#EBEBEB] text-[#007AFF] focus:ring-[#007AFF]" />
                      
                          <span className="text-[13px] font-medium text-[#222222]">
                            {day}
                          </span>
                        </div>
                        <div className="w-full flex items-center border border-[#EBEBEB] rounded-[6px] px-2 py-1 bg-white">
                          <input
                        type="text"
                        defaultValue="09:00"
                        className="w-full text-[12px] text-center focus:outline-none" />
                      
                        </div>
                        <div className="w-full flex items-center border border-[#EBEBEB] rounded-[6px] px-2 py-1 bg-white">
                          <input
                        type="text"
                        defaultValue="17:00"
                        className="w-full text-[12px] text-center focus:outline-none" />
                      
                        </div>
                      </div>

                )}
                </div>
              </div>

              <div>
                <label className="block text-[12px] md:text-[13px] font-medium text-[#222222] mb-1.5">
                  Notes
                </label>
                <textarea
                placeholder="e.g. deep cleaning specialist, has own transport"
                className="w-full h-20 p-3 border border-[#EBEBEB] rounded-[8px] text-[13px] md:text-[14px] focus:outline-none focus:border-[#007AFF] focus:ring-1 focus:ring-[#007AFF] resize-none">
              </textarea>
              </div>

              <div className="flex flex-col-reverse sm:flex-row justify-end gap-3 pt-4 border-t border-[#F0F0F0]">
                <button
                onClick={() => setShowAddForm(false)}
                className="w-full sm:w-auto px-4 py-2 text-[13px] md:text-[14px] font-semibold text-[#222222] bg-white border border-[#EBEBEB] rounded-[8px] hover:bg-[#F7F7F7]">
                
                  Cancel
                </button>
                <button
                onClick={() => setShowAddForm(false)}
                className="w-full sm:w-auto px-4 py-2 text-[13px] md:text-[14px] font-semibold text-white bg-[#007AFF] rounded-[8px] hover:bg-[#0066CC] shadow-[0_1px_3px_rgba(0,122,255,0.3)]">
                
                  Add Cleaner
                </button>
              </div>
            </div>
          </div>
        }
      </div>

      {/* Info Banner */}
      <div className="bg-[#EFF6FF] border border-[#BFDBFE] rounded-[8px] p-3 md:p-4 flex items-start gap-3">
        <Info
          className="w-5 h-5 text-[#2563EB] flex-shrink-0 mt-0.5"
          strokeWidth={2} />
        
        <p className="text-[12px] md:text-[13px] text-[#1E3A8A] leading-relaxed">
          <span className="font-semibold">Cleaner Self-Service Portal:</span>{' '}
          Each cleaner can log in with their phone number to set their own
          availability, view upcoming jobs, and update their calendar. Send them
          their login link from the cleaner's Edit view.
        </p>
      </div>

      {/* Pay Summary */}
      <div className="bg-white rounded-[12px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] border border-[#EBEBEB] p-4 md:p-6">
        <h2 className="text-[15px] md:text-[16px] font-semibold text-[#222222] mb-3 md:mb-4">
          Pay Summary
        </h2>
        <div className="max-w-md">
          <label className="block text-[12px] md:text-[13px] font-medium text-[#222222] mb-1.5">
            Month
          </label>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <input
                type="text"
                value={selectedMonth}
                readOnly
                className="w-full h-10 pl-3 pr-10 border border-[#EBEBEB] rounded-[8px] text-[13px] md:text-[14px] focus:outline-none focus:border-[#007AFF] focus:ring-1 focus:ring-[#007AFF] bg-white cursor-pointer" />
              
              <CalendarIcon className="w-4 h-4 text-[#717171] absolute right-3 top-3 pointer-events-none" />
            </div>
            <button className="w-full sm:w-auto px-4 py-2 text-[13px] md:text-[14px] font-semibold text-[#222222] bg-[#F7F7F7] border border-[#EBEBEB] rounded-[8px] hover:bg-[#F0F0F0]">
              Export CSV
            </button>
          </div>
          <p className="text-[12px] md:text-[13px] text-[#717171] mt-2 md:mt-3">
            Select a month to view pay summary.
          </p>
        </div>
      </div>
    </div>);

}