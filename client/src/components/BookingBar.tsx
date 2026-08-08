import React from 'react';
import { Booking, TODAY, formatTotal } from '../data/properties';
interface BookingBarProps {
  booking: Booking;
  style: React.CSSProperties;
  onClick?: (booking: Booking) => void;
  /**
   * What the bar reads. Defaults to name and total. The cleaner portal
   * passes a version without the money — the same grid serves both, and
   * a cleaner must never be shown what a guest paid.
   */
  label?: (booking: Booking) => string;
  /** Neutral bar: no channel colour, no channel badge. */
  plain?: boolean;
}
export function BookingBar({ booking, style, onClick, label, plain }: BookingBarProps) {
  const isPast = booking.checkOut <= TODAY;
  const getStyles = () => {
    switch (booking.type) {
      case 'airbnb':
        return {
          bar: 'bg-[#FF385C]/55 text-white',
          icon: 'bg-[#FF385C] text-white'
        };
      case 'bcom':
        return {
          bar: 'bg-[#003580]/55 text-white',
          icon: 'bg-[#003580] text-white'
        };
      case 'direct':
        return {
          bar: 'bg-[#717171]/40 text-white',
          icon: 'bg-[#717171] text-white font-extrabold text-[9px]'
        };
      case 'blocked':
        // A block is the one bar that means "no money here", so it has to
        // read as deliberate rather than as a rendering artefact. The old
        // #F5F5F5-on-#EBEBEB hatch was a 4% contrast step that vanished
        // outright once the past-dimming was applied on top of it.
        return {
          bar: 'text-[#5A5A5A] ring-1 ring-inset ring-[#D0D0D0]',
          icon: 'bg-[#8A8A8A] text-white font-bold text-[9px]',
          customBg:
          'repeating-linear-gradient(-45deg, #EDEDED, #EDEDED 4px, #D6D6D6 4px, #D6D6D6 8px)'
        };
    }
  };
  const styles = plain ?
  { bar: 'bg-[#8A8A8A] text-white', icon: '', customBg: undefined } :
  getStyles();
  const renderIcon = () => {
    switch (booking.type) {
      case 'airbnb':
        return (
          <svg className="w-2.5 h-2.5 fill-current" viewBox="0 0 448 512">
            <path d="M224 373.12c-25.24-31.67-40.08-59.43-45-83.18c-22.55-88 112.61-88 90.06 0c-5.45 24.25-20.29 52-45 83.18zm138.15 73.23c-42.06 18.31-83.67-10.88-119.3-50.47c103.9-130.07 46.11-200-18.85-200c-54.92 0-85.16 46.51-73.28 100.5c6.93 29.19 25.23 62.39 54.43 99.5c-32.53 36.05-60.55 52.69-85.15 54.92c-50 7.43-89.11-41.06-71.3-91.09c15.1-39.16 111.72-231.18 115.87-241.56c15.75-30.07 25.56-57.4 59.38-57.4c32.34 0 43.4 25.94 60.37 59.87c36 70.62 89.35 177.48 114.84 239.09c13.17 33.07-1.37 71.29-37.01 86.64m47-136.12C280.27 35.93 273.13 32 224 32c-45.52 0-64.87 31.67-84.66 72.79C33.18 317.1 22.89 347.19 22 349.81C-3.22 419.14 48.74 480 111.63 480c21.71 0 60.61-6.06 112.37-62.4c58.68 63.78 101.26 62.4 112.37 62.4c62.89.05 114.85-60.86 89.61-130.19c.02-3.89-16.82-38.9-16.82-39.58z" />
          </svg>);

      case 'bcom':
        return (
          <svg className="w-2.5 h-2.5 fill-current" viewBox="0 0 3.036 3.037">
            <path d="M1.113 2.524h-.51v-.61c0-.13.05-.2.162-.214h.35a.38.38 0 0 1 .41.411c0 .26-.157.415-.41.415zM.602.875v-.16c0-.14.06-.208.19-.216h.262c.224 0 .36.134.36.36 0 .17-.092.37-.35.37h-.46zm1.164.61l-.092-.052.08-.07c.094-.08.25-.262.25-.575 0-.48-.372-.79-.947-.79h-.73a.32.32 0 0 0-.309.317v2.72H1.07c.64 0 1.052-.348 1.052-.888 0-.29-.133-.54-.358-.665" />
            <circle cx="2.655" cy="2.67" r=".367" />
          </svg>);

      case 'direct':
        return 'D';
      case 'blocked':
        return '✕';
    }
  };
  return (
    <div
      onClick={() => onClick?.(booking)}
      // Past stays are de-emphasised, not erased — at opacity-30 a whole
      // completed week read as a rendering fault rather than as history.
      className={`absolute flex items-center gap-1.5 px-1.5 overflow-hidden text-[10px] leading-none font-semibold cursor-pointer transition-opacity hover:opacity-100 active:opacity-75 shadow-[0_1px_2px_rgba(0,0,0,0.06)] ${styles.bar} ${isPast ? 'grayscale-[40%] opacity-55' : ''}`}
      style={{
        ...style,
        background: styles.customBg || undefined
      }}>
      
      {!plain &&
      <div
        className={`w-[18px] h-[18px] rounded-full flex items-center justify-center shrink-0 overflow-hidden ${styles.icon}`}>
        
        {renderIcon()}
      </div>
      }
      <div className="truncate flex-1 min-w-0 pr-1">
        {label ?
        label(booking) :
        booking.total ?
        `${booking.name} · ${formatTotal(booking.total)}` :
        booking.name}
      </div>
    </div>);

}