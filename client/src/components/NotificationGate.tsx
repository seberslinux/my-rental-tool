import React, { useCallback, useEffect, useState } from 'react';
import { Bell, Share, Plus, Settings } from 'lucide-react';
import { pushState, enablePush, PushState } from '../data/push';

/**
 * A cleaner cannot use the app until their phone can be told about jobs.
 *
 * Push is the only way a cleaner hears about a shift. Every cleaner
 * notification for a month went to WhatsApp and failed, and not one
 * cleaner had turned push on, because the switch sat at the bottom of a
 * page nobody scrolled to. So the switch is the front door now.
 *
 * A phone only shows notifications its owner allowed, and only from a
 * tap, so this cannot be done for them. What it can do is make that tap
 * the one thing on screen, and not open the app until it has happened.
 *
 * Two states let them through, because blocking would leave them with
 * nothing they could do about it: a browser that cannot receive push at
 * all, and a server with push switched off.
 */

const PASSES: PushState[] = ['ready', 'unsupported', 'not-configured'];

export function NotificationGate({
  children,
  onSignOut,
}: {
  children: React.ReactNode;
  onSignOut: () => void;
}) {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);

  const check = useCallback(() => {
    pushState().then(setState).catch(() => setState('unsupported'));
  }, []);

  // Again on return: somebody who left to change a setting or to add the
  // app to their Home Screen comes back to a screen that already knows.
  useEffect(() => {
    check();
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [check]);

  if (!state) return null;
  if (PASSES.includes(state)) return <>{children}</>;

  const turnOn = async () => {
    setBusy(true);
    try {
      setState(await enablePush());
    } catch {
      setState(await pushState().catch(() => 'unsupported' as PushState));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F7F7F7] flex flex-col items-center justify-center px-6 font-sans text-[#222222] antialiased">
      <div className="w-full max-w-[360px] bg-white rounded-[16px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] p-6 text-center">
        <span className="mx-auto w-12 h-12 rounded-full bg-[#FFF1F3] text-[#FF385C] flex items-center justify-center">
          <Bell className="w-6 h-6" />
        </span>

        <h1 className="text-[20px] font-semibold mt-4">Turn on notifications</h1>
        <p className="text-[15px] text-[#717171] mt-1">
          Your jobs, changes and reminders come to your phone this way. The app opens once they are on.
        </p>

        {state === 'can-ask' &&
        <>
            <button
            disabled={busy}
            onClick={turnOn}
            className="mt-5 w-full py-3 rounded-[10px] bg-[#FF385C] text-white text-[16px] font-semibold disabled:opacity-50">
              {busy ? 'Working…' : 'Turn on notifications'}
            </button>
            <p className="text-[13px] text-[#717171] mt-2">When your phone asks, tap Allow.</p>
          </>
        }

        {/* iOS sends alerts only to an app on the Home Screen, and offers no button for it. */}
        {state === 'needs-install' &&
        <ol className="mt-5 text-left text-[15px] space-y-3">
            <li className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold">1.</span> Tap
              <Share className="w-5 h-5 text-[#007AFF]" strokeWidth={2} />
              at the bottom of the screen
            </li>
            <li className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold">2.</span> Tap
              <Plus className="w-5 h-5" strokeWidth={2} />
              <span className="font-medium">Add to Home Screen</span>
            </li>
            <li>
              <span className="font-semibold">3.</span> Open the app from the new icon on your Home Screen
            </li>
          </ol>
        }

        {state === 'denied' &&
        <div className="mt-5 text-left text-[15px] space-y-2">
            <p className="flex items-center gap-2">
              <Settings className="w-5 h-5 text-[#717171]" /> Notifications are blocked on this phone.
            </p>
            <p className="text-[#717171]">
              iPhone: Settings → Notifications → My Rentals → Allow Notifications.
              Android: tap the lock next to the address, then Notifications → Allow.
            </p>
            <button
            onClick={check}
            className="mt-3 w-full py-3 rounded-[10px] border border-[#DDDDDD] text-[16px] font-semibold">
              I've turned them on
            </button>
          </div>
        }
      </div>

      <button onClick={onSignOut} className="mt-6 text-[14px] text-[#717171] underline underline-offset-2">
        Sign out
      </button>
    </div>);

}
