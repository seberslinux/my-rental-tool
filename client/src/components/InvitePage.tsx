import React, { useEffect, useRef, useState } from 'react';
import { Home } from 'lucide-react';

interface InvitePageProps {
  token: string;
  onDone: () => void;
}

/**
 * Where a cleaner sets their own PIN.
 *
 * The owner decides who gets access and sends the link; the cleaner
 * decides how they get in. Nothing here asks for the phone number — the
 * invitation already identifies them, and asking would only be one more
 * thing to type wrong.
 *
 * The greeting is the point of the name lookup: a cleaner should be able
 * to tell a link meant for them from one sent to the wrong number,
 * before they commit a PIN to it.
 */
export function InvitePage({ token, onDone }: InvitePageProps) {
  const [name, setName] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [invalid, setInvalid] = useState(false);
  const [pin, setPin] = useState(['', '', '', '']);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const refs = [
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
  ];

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/auth/invite/${encodeURIComponent(token)}`, {
          credentials: 'same-origin',
        });
        if (!res.ok) { setInvalid(true); return; }
        const data = await res.json();
        setName(data.name);
      } catch {
        setInvalid(true);
      } finally {
        setChecking(false);
      }
    })();
  }, [token]);

  const setDigit = (i: number, v: string) => {
    const d = v.replace(/\D/g, '').slice(-1);
    const next = [...pin];
    next[i] = d;
    setPin(next);
    if (d && i < 3) refs[i + 1].current?.focus();
  };

  const onKey = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && pin[i] === '' && i > 0) refs[i - 1].current?.focus();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = pin.join('');
    if (value.length !== 4) { setError('Enter all 4 digits'); return; }
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/auth/invite/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ pin: value }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Could not set your PIN');
      }
      // The invitation signs them in, so there is no second login step.
      window.history.replaceState({}, '', '/');
      onDone();
    } catch (err: any) {
      setError(err.message);
      setSaving(false);
    }
  };

  const Shell = ({ children }: { children: React.ReactNode }) =>
  <div className="min-h-screen bg-[#F7F7F7] flex items-center justify-center p-4 font-sans text-[#222222] antialiased">
      <div className="bg-white rounded-[16px] shadow-[0_2px_8px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] p-6 sm:p-8 w-full max-w-[400px]">
        <div className="flex flex-col items-center mb-6">
          <div className="w-12 h-12 bg-[#FF385C14] rounded-full flex items-center justify-center mb-4">
            <Home className="w-6 h-6 text-[#FF385C]" strokeWidth={2} />
          </div>
          {children}
        </div>
      </div>
    </div>;

  if (checking) {
    return <Shell><p className="text-[14px] text-[#717171]">Checking your invitation…</p></Shell>;
  }

  if (invalid) {
    return (
      <Shell>
        <h1 className="text-[20px] font-bold mb-1 text-center">Invitation expired</h1>
        <p className="text-[14px] text-[#717171] text-center">
          This link has already been used or has run out. Ask for a new one.
        </p>
      </Shell>);
  }

  return (
    <div className="min-h-screen bg-[#F7F7F7] flex items-center justify-center p-4 font-sans text-[#222222] antialiased">
      <div className="bg-white rounded-[16px] shadow-[0_2px_8px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] p-6 sm:p-8 w-full max-w-[400px]">
        <div className="flex flex-col items-center mb-6">
          <div className="w-12 h-12 bg-[#FF385C14] rounded-full flex items-center justify-center mb-4">
            <Home className="w-6 h-6 text-[#FF385C]" strokeWidth={2} />
          </div>
          <h1 className="text-[22px] font-bold tracking-[-0.5px] mb-1 text-center">
            Hi {name}
          </h1>
          <p className="text-[14px] text-[#717171] text-center">
            Choose a 4-digit PIN. You'll use it with your phone number to sign in.
          </p>
        </div>

        {error &&
        <div className="bg-[#FEF2F2] border border-[#FCA5A5] rounded-[8px] px-3 py-2 mb-4 text-[13px] text-[#991B1B]">
            {error}
          </div>
        }

        <form onSubmit={submit}>
          <div className="flex justify-center gap-3 mb-6">
            {pin.map((d, i) =>
            <input
              key={i}
              ref={refs[i]}
              type="tel"
              inputMode="numeric"
              autoFocus={i === 0}
              maxLength={1}
              value={d}
              onChange={(e) => setDigit(i, e.target.value)}
              onKeyDown={(e) => onKey(i, e)}
              aria-label={`PIN digit ${i + 1}`}
              className="w-[56px] h-[64px] text-center text-[24px] font-semibold border border-[#DDDDDD] rounded-[10px] focus:outline-none focus:border-[#FF385C] focus:ring-1 focus:ring-[#FF385C] transition-colors" />
            )}
          </div>

          <button
            type="submit"
            disabled={saving}
            className="w-full h-[48px] bg-[#FF385C] text-white rounded-[8px] text-[15px] font-semibold hover:bg-[#E31C5F] active:bg-[#D70466] disabled:opacity-60 transition-colors">
            {saving ? 'Setting your PIN…' : 'Set PIN and continue'}
          </button>
        </form>

        <p className="text-[12px] text-[#717171] text-center mt-4">
          Keep your PIN to yourself. Nobody else can see it.
        </p>
      </div>
    </div>);

}
