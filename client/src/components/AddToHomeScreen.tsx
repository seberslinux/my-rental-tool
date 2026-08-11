import React, { useEffect, useState } from 'react';
import { Share, X, Plus } from 'lucide-react';

/**
 * Ask an iPhone to install the app.
 *
 * Every other platform offers to do this itself — Chrome fires
 * beforeinstallprompt and shows a button. Safari on iOS fires nothing
 * and offers nothing, so an app that never mentions it simply never gets
 * installed, and on iOS an uninstalled app cannot receive push at all.
 * So the one place it matters most is the one place we have to ask.
 *
 * Shown once, dismissible, and only when it is actually actionable:
 * an iPhone or iPad, in Safari, not already installed.
 */

const DISMISSED = 'a2hs-dismissed';

/** Running from the Home Screen rather than a Safari tab. */
export function isInstalled(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches ||
  // Safari's own flag, which predates display-mode and is still the
  // only reliable signal on older iOS.
  (window.navigator as any).standalone === true;
}

function isIOSSafari(): boolean {
  const ua = window.navigator.userAgent;
  const iOS = /iPad|iPhone|iPod/.test(ua) ||
  // iPadOS 13+ reports itself as a Mac; the touch points give it away.
  (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
  const webkit = /WebKit/.test(ua);
  const otherBrowser = /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
  return iOS && webkit && !otherBrowser;
}

export function AddToHomeScreen() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (isInstalled()) return;
    if (!isIOSSafari()) return;
    if (localStorage.getItem(DISMISSED)) return;
    setShow(true);
  }, []);

  if (!show) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISSED, '1');
    setShow(false);
  };

  return (
    <div className="fixed inset-x-3 bottom-[76px] z-[80] bg-white rounded-[12px] shadow-[0_8px_24px_rgba(0,0,0,0.18)] border border-[#EBEBEB] p-4">
      <div className="flex items-start gap-3">
        <img src="/icons/icon-192.png" alt="" className="w-9 h-9 rounded-[8px] shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-semibold text-[#222222]">Put this on your Home Screen</p>
          <p className="text-[13px] text-[#717171] mt-0.5">
            It opens like an app, and it is the only way an iPhone will let us send you
            job alerts.
          </p>
          <p className="text-[13px] text-[#222222] mt-2 flex flex-wrap items-center gap-1.5">
            Tap
            <Share className="w-4 h-4 text-[#007AFF]" strokeWidth={2} />
            <span className="text-[#717171]">then</span>
            <Plus className="w-4 h-4" strokeWidth={2} />
            <span className="font-medium">Add to Home Screen</span>
          </p>
        </div>
        <button onClick={dismiss} aria-label="Not now" className="p-1 -mr-1 -mt-1 shrink-0">
          <X className="w-5 h-5 text-[#717171]" />
        </button>
      </div>
    </div>);

}
