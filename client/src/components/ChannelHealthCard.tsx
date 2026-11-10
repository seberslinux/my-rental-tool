import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, AlertTriangle, Check, RefreshCw, ArrowRight, X } from 'lucide-react';
import { apiGet, Unauthorized } from '../data/session';

/**
 * Whether the settings nobody looks at are still right.
 *
 * Three settings cost real money last year and each was found by
 * somebody auditing by hand, months late: a block-after-booking rule
 * worth about R60k, a base price that sold Booking.com nights at R113,
 * and one room that reached thirty days ahead while the other had a
 * year. This is the card that would have said so the next morning.
 *
 * ## Why it does not fetch Smoobu
 *
 * It reads the stored answer from the 06:00 run. A card that checked on
 * every load would cost two Smoobu calls per page view, be slow on a
 * good day and blank on a bad one — and the question it answers does
 * not change between now and the next run. "Check now" is there for
 * when somebody has just changed something.
 *
 * ## Why "not checked yet" is a state
 *
 * A listing with no stored answer is drawn as unchecked, never as a
 * green tick. The whole point of this card is that a confident green
 * was what the dashboard showed for the four months the loft was
 * selling at R113.
 */

interface Finding {
  key: string;
  severity: 'red' | 'amber' | 'green';
  title: string;
  detail: string;
  count: number;
  examples: string[];
  /** The key it is put away under, and whether it has been. */
  dismiss_key?: string;
  dismissed?: boolean;
}

interface Result {
  property_id: number;
  property: string;
  status: 'red' | 'amber' | 'green';
  horizon: {priced_to: string | null;days: number;target: number;} | null;
  findings: Finding[];
}

const ago = (iso: string | null) => {
  if (!iso) return '';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days}d ago`;
};

export function ChannelHealthCard({ onNavigate, propertyId = 0 }: {
  /** Somewhere to send somebody who wants to fix a price. */
  onNavigate?: (tab: string) => void;
  /** The property picked at the top of Home, so this agrees with the rest of the page. */
  propertyId?: number;
}) {
  const [results, setResults] = useState<Result[]>([]);
  const [status, setStatus] = useState<'red' | 'amber' | 'green'>('green');
  const [ranAt, setRanAt] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await apiGet<{status: Result['status'];results: Result[];ran_at: string | null;}>(
        '/api/health/channels');
      setResults(data.results || []);
      setStatus(data.status || 'green');
      setRanAt(data.ran_at || null);
      setFailed(false);
    } catch (e) {
      if (!(e instanceof Unauthorized)) setFailed(true);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const checkNow = async () => {
    setChecking(true);
    setError('');
    const res = await fetch('/api/health/channels/run', { method: 'POST', credentials: 'same-origin' });
    setChecking(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || 'Could not check');
      return;
    }
    const data = await res.json();
    setResults(data.results || []);
    setStatus(data.status || 'green');
    setRanAt(data.ran_at || null);
    // Something is wrong, so show what rather than making them tap again.
    if ((data.status || 'green') !== 'green') setOpen(true);
  };

  const mine = propertyId ? results.filter((r) => r.property_id === propertyId) : results;

  /**
   * What is left once somebody has put things away.
   *
   * The headline said "2 things need fixing now" over a list of four —
   * it counted the reds and listed the ambers too. Both are counted now,
   * and named separately, and anything put away is out of both.
   */
  const problems = mine.flatMap((r) => r.findings.filter((f) => f.severity !== 'green' && !f.dismissed));
  const reds = problems.filter((f) => f.severity === 'red').length;
  const ambers = problems.length - reds;
  const checked = mine.length > 0;
  const shownStatus: 'red' | 'amber' | 'green' = reds ? 'red' : ambers ? 'amber' : 'green';

  const headline =
    failed ? 'Could not read the last check' :
    !checked ? 'Not checked yet' :
    !problems.length ? 'Prices and horizons look right' :
    [reds ? `${reds} to fix` : '', ambers ? `${ambers} to look at` : ''].filter(Boolean).join(' · ');

  /** Put a finding away. It comes back if it gets worse. */
  const putAway = async (f: Finding) => {
    if (!f.dismiss_key) return;
    setError('');
    const res = await fetch('/api/dashboard/dismiss', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ key: f.dismiss_key, severity: f.severity }),
    });
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || 'Could not put that away');
      return;
    }
    setResults((list) => list.map((r) => ({
      ...r,
      findings: r.findings.map((x) => x.dismiss_key === f.dismiss_key ? { ...x, dismissed: true } : x),
    })));
  };

  const Icon = failed || shownStatus === 'red' ? AlertCircle : !checked || shownStatus === 'amber' ? AlertTriangle : Check;
  const tone = failed || shownStatus === 'red' ? 'text-[#D93900]' : !checked || shownStatus === 'amber' ? 'text-[#B45309]' : 'text-[#0F6E56]';

  return (
    <div className="mb-6">
      <div className="text-[12px] font-semibold uppercase tracking-[0.5px] text-[#B0B0B0] pb-2">
        Channel health
      </div>

      {error && <p className="mb-2 text-[13px] text-[#991B1B]">{error}</p>}

      <div className="bg-white rounded-[12px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3">
          <Icon className={`w-4 h-4 shrink-0 ${tone}`} />
          <button
            onClick={() => setOpen((o) => !o)}
            disabled={!checked && !failed}
            className="flex-1 min-w-0 text-left disabled:cursor-default">
            <div className="text-[15px] font-medium text-[#222222] truncate">{headline}</div>
            <div className="text-[13px] text-[#717171] truncate">
              {checked ?
              `${mine.length} listing${mine.length === 1 ? '' : 's'} · checked ${ago(ranAt)}` :
              'Nothing has looked at your prices or how far ahead you are on sale'}
            </div>
          </button>
          <button
            onClick={checkNow}
            disabled={checking}
            className="shrink-0 flex items-center gap-1 text-[13px] font-semibold text-[#FF385C] disabled:opacity-50">
            <RefreshCw className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`} />
            {checking ? 'Checking…' : 'Check now'}
          </button>
        </div>

        {open && checked &&
        <div className="border-t border-[#F0F0F0]">
            {problems.length === 0 ?
          <div className="px-4 py-3 text-[13px] text-[#717171]">
                {mine.map((r) =>
            <div key={r.property_id}>
                    {r.property}: on sale {r.horizon ? `${r.horizon.days} of ${r.horizon.target} days` : 'unknown'}, nothing outside your limits.
                  </div>
            )}
              </div> :

          problems.map((f, i) =>
          <div key={f.key + i} className={`px-4 py-3 ${i > 0 ? 'border-t border-[#F0F0F0]' : ''}`}>
                  <div className="flex items-start gap-2">
                    <span className={`mt-[6px] shrink-0 w-[6px] h-[6px] rounded-full ${
            f.severity === 'red' ? 'bg-[#D93900]' : 'bg-[#C9A227]'}`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[14px] font-medium text-[#222222] flex items-start gap-2">
                        <span className="flex-1">{f.title}</span>
                        {f.dismiss_key &&
                  <button
                    onClick={() => putAway(f)}
                    aria-label={`Hide "${f.title}"`}
                    title="Hide — it comes back if it gets worse"
                    className="shrink-0 p-0.5 text-[#B0B0B0] hover:text-[#717171]">
                            <X className="w-4 h-4" />
                          </button>
                  }
                      </div>
                      <div className="text-[13px] text-[#717171]">{f.detail}</div>
                      {/* The dates, so somebody can go and look rather
                          than take the count on trust. */}
                      {f.examples.length > 0 &&
                <div className="text-[12px] text-[#717171] mt-0.5 tabular-nums">
                          {f.examples.join(', ')}{f.count > f.examples.length ? ` and ${f.count - f.examples.length} more` : ''}
                        </div>
                }
                    </div>
                  </div>
                </div>
          )
          }
            {onNavigate &&
          <button
            onClick={() => onNavigate('rates')}
            className="w-full border-t border-[#F0F0F0] px-4 py-3 flex items-center justify-between text-[13px] font-semibold text-[#FF385C]">
                Open Rates
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
          }
          </div>
        }
      </div>
    </div>);

}
