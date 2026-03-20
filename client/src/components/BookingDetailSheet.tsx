import React from 'react';
import { X } from 'lucide-react';
import { Booking, properties, formatTotal } from '../data/properties';
interface BookingDetailSheetProps {
  booking: Booking | null;
  onClose: () => void;
}
export function BookingDetailSheet({
  booking,
  onClose
}: BookingDetailSheetProps) {
  if (!booking) return null;
  const property = properties.find((p) => p.id === booking.propId);
  const nights = Math.round(
    (booking.checkOut.getTime() - booking.checkIn.getTime()) / (
    1000 * 60 * 60 * 24)
  );
  const getPlatformDetails = (type: string) => {
    switch (type) {
      case 'airbnb':
        return {
          name: 'Airbnb',
          bg: 'bg-[#FF385C]',
          text: 'text-white'
        };
      case 'bcom':
        return {
          name: 'Booking.com',
          bg: 'bg-[#003580]',
          text: 'text-white'
        };
      case 'direct':
        return {
          name: 'Direct Booking',
          bg: 'bg-[#717171]',
          text: 'text-white'
        };
      case 'blocked':
        return {
          name: 'Blocked Dates',
          bg: 'bg-[#EBEBEB]',
          text: 'text-[#717171]'
        };
      default:
        return {
          name: type,
          bg: 'bg-gray-200',
          text: 'text-gray-800'
        };
    }
  };
  const platform = getPlatformDetails(booking.type);
  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/20 z-[60] transition-opacity"
        onClick={onClose} />
      

      {/* Sheet */}
      <div className="fixed bottom-0 left-0 right-0 bg-white rounded-t-[16px] z-[70] shadow-2xl transform transition-transform duration-300 ease-out translate-y-0 pb-8">
        <div className="flex justify-center pt-3 pb-4">
          <div className="w-[36px] h-[4px] bg-[#DDDDDD] rounded-full" />
        </div>

        <div className="px-6 pb-6">
          <div className="flex justify-between items-start mb-8">
            <div>
              <h2 className="text-[24px] font-semibold text-[#222222] leading-tight">
                {booking.name}
              </h2>
              <p className="text-[14px] text-[#717171] mt-1">
                {property?.name}
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 bg-[#F7F7F7] rounded-full hover:bg-[#EBEBEB] transition-colors">
              
              <X className="w-5 h-5 text-[#222222]" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-8">
            <div className="bg-white border border-[#EBEBEB] p-4 rounded-xl">
              <p className="text-[10px] text-[#717171] uppercase font-semibold mb-1 tracking-wide">
                Check-in
              </p>
              <p className="font-medium text-[#222222]">
                {booking.checkIn.toLocaleDateString('en-US', {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric'
                })}
              </p>
              <p className="text-[12px] text-[#717171] mt-1">From 15:00</p>
            </div>
            <div className="bg-white border border-[#EBEBEB] p-4 rounded-xl">
              <p className="text-[10px] text-[#717171] uppercase font-semibold mb-1 tracking-wide">
                Check-out
              </p>
              <p className="font-medium text-[#222222]">
                {booking.checkOut.toLocaleDateString('en-US', {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric'
                })}
              </p>
              <p className="text-[12px] text-[#717171] mt-1">By 10:00</p>
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex justify-between items-center py-4 border-b border-[#EBEBEB]">
              <span className="text-[#222222]">Status</span>
              <span
                className={`font-medium px-3 py-1 rounded-full text-[12px] ${platform.bg} ${platform.text}`}>
                
                {platform.name}
              </span>
            </div>
            <div className="flex justify-between items-center py-4 border-b border-[#EBEBEB]">
              <span className="text-[#222222]">Duration</span>
              <span className="font-medium text-[#222222]">
                {nights} nights
              </span>
            </div>
            {booking.total > 0 &&
            <div className="flex justify-between items-center py-4 border-b border-[#EBEBEB]">
                <span className="text-[#222222]">Total Payout</span>
                <span className="font-semibold text-[20px] text-[#222222]">
                  {formatTotal(booking.total)}
                </span>
              </div>
            }
          </div>
        </div>
      </div>
    </>);

}