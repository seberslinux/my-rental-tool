import React, { useEffect, useState } from 'react';
import { Bell, BellOff, Check, Share, Plus } from 'lucide-react';
import { pushState, enablePush, disablePush, sendTestPush, PushState } from '../data/push';

/**
 * Turning notifications on, and proving they arrive.
 *
 * A switch that silently does nothing is worse than no switch, and there
 * are four separate reasons this can be unavailable — not installed, not
 * permitted, not supported, not configured on the server. Each one says
 * which, because "notifications are off" leaves somebody with nothing to
 * try.
 *
 * The test button earns its place: until a notification has actually
 * appeared on the handset in your hand, nobody has any reason to believe
 * the switch. This is replacing a WhatsApp path that reported success
 * and delivered nothing for months.
 */

const EXPLAIN: Record<PushState, string> = {
  ready: 'You will be told about new jobs and changes.',
  'can-ask': 'Get told about new jobs without opening the app.',
  'needs-install': 'Add this to your Home Screen first — an iPhone will only send alerts to an installed app.',
  denied: 'Notifications are blocked for this site. Turn them back on in your browser or iPhone settings.',
  unsupported: 'This browser cannot receive notifications.',
  'not-configured': 'Notifications are not switched on for this server yet.',
};

export function NotificationSetting() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [tested, setTested] = useState<'' | 'sent' | 'failed'>('');

  useEffect(() => { pushState().then(setState); }, []);

  if (!state) return null;

  const turnOn = async () => {
    setBusy(true);
    setTested('');
    try {
      setState(await enablePush());
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    setBusy(true);
    setTested('');
    try {
      await disablePush();
      setState('can-ask');
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    setTested((await sendTestPush()) ? 'sent' : 'failed');
    setBusy(false);
  };

  return (
    <div className="bg-white rounded-[12px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] px-4 py-3">
      <div className="flex items-start gap-3">
        <span className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
        state === 'ready' ? 'bg-[#EAF4F0] text-[#0F6E56]' : 'bg-[#F0F0F0] text-[#717171]'}`}>
          {state === 'ready' ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
        </span>

        <div className="flex-1 min-w-0">
          <div className="text-[15px] font-medium text-[#222222]">
            {state === 'ready' ? 'Notifications are on' : 'Notifications'}
          </div>
          <div className="text-[13px] text-[#717171]">{EXPLAIN[state]}</div>

          {/* iOS gives no install button, so the steps have to be said. */}
          {state === 'needs-install' &&
          <p className="text-[13px] text-[#222222] mt-2 flex flex-wrap items-center gap-1.5">
              Tap
              <Share className="w-4 h-4 text-[#007AFF]" strokeWidth={2} />
              <span className="text-[#717171]">then</span>
              <Plus className="w-4 h-4" strokeWidth={2} />
              <span className="font-medium">Add to Home Screen</span>
            </p>
          }

          {tested === 'sent' &&
          <p className="text-[13px] text-[#0F6E56] mt-2 flex items-center gap-1.5">
              <Check className="w-4 h-4" strokeWidth={3} /> Sent — it should appear in a moment.
            </p>
          }
          {tested === 'failed' &&
          <p className="text-[13px] text-[#991B1B] mt-2">
              Nothing went out. The subscription may have expired — turn it off and on again.
            </p>
          }
        </div>

        <div className="shrink-0 flex flex-col items-end gap-1.5">
          {state === 'can-ask' &&
          <button
            disabled={busy}
            onClick={turnOn}
            className="px-3 py-1.5 rounded-[8px] bg-[#222222] text-white text-[13px] font-semibold disabled:opacity-50">
              {busy ? 'Working…' : 'Turn on'}
            </button>
          }
          {state === 'ready' &&
          <>
              <button
              disabled={busy}
              onClick={test}
              className="px-3 py-1.5 rounded-[8px] border border-[#DDDDDD] text-[13px] font-semibold disabled:opacity-50">
                {busy ? 'Sending…' : 'Send a test'}
              </button>
              <button
              disabled={busy}
              onClick={turnOff}
              className="text-[12px] text-[#717171] underline underline-offset-2 disabled:opacity-50">
                Turn off
              </button>
            </>
          }
        </div>
      </div>
    </div>);

}
