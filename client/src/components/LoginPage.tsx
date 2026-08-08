import React, { useState, useRef } from 'react';
import { Home } from 'lucide-react';
interface LoginPageProps {
  onLogin: (role?: string) => void;
}
export function LoginPage({ onLogin }: LoginPageProps) {
  const [activeTab, setActiveTab] = useState<'email' | 'phone'>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState(['', '', '', '']);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const pinRefs = [
  useRef<HTMLInputElement>(null),
  useRef<HTMLInputElement>(null),
  useRef<HTMLInputElement>(null),
  useRef<HTMLInputElement>(null)];

  const handlePinChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const newPin = [...pin];
    newPin[index] = value;
    setPin(newPin);
    // Auto-advance
    if (value !== '' && index < 3) {
      pinRefs[index + 1].current?.focus();
    }
  };
  const handlePinKeyDown = (
  index: number,
  e: React.KeyboardEvent<HTMLInputElement>) =>
  {
    if (e.key === 'Backspace' && pin[index] === '' && index > 0) {
      pinRefs[index - 1].current?.focus();
    }
  };
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (activeTab === 'email') {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ email, password }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({ error: 'Login failed' }));
          throw new Error(data.error || 'Login failed');
        }
      } else {
        const pinStr = pin.join('');
        if (pinStr.length !== 4) { setError('Enter all 4 digits'); setLoading(false); return; }
        const res = await fetch('/api/auth/cleaner-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ phone, pin: pinStr }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({ error: 'Login failed' }));
          throw new Error(data.error || 'Login failed');
        }
        // The role comes back on the login response. Passing it up means
        // a cleaner lands in their own app immediately — before this, the
        // role was only read once when the page first loaded, so signing
        // in with a phone number dropped you into the manager's app until
        // you happened to refresh.
        const who = await res.json().catch(() => ({}));
        onLogin(who.role);
        return;
      }
      onLogin();
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };
  const handleGoogleLogin = () => {
    window.location.href = '/api/auth/google';
  };
  return (
    <div className="min-h-screen bg-[#F7F7F7] flex items-center justify-center p-4 font-sans text-[#222222] antialiased">
      <div className="bg-white rounded-[16px] shadow-[0_2px_8px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] p-6 sm:p-8 w-full max-w-[400px]">
        {/* Header */}
        <div className="flex flex-col items-center mb-6">
          <div className="w-12 h-12 bg-[#FF385C14] rounded-full flex items-center justify-center mb-4">
            <Home className="w-6 h-6 text-[#FF385C]" strokeWidth={2} />
          </div>
          <h1 className="text-[24px] font-bold tracking-[-0.5px] mb-1">
            Rental Manager
          </h1>
          <p className="text-[14px] text-[#717171]">Sign in to your account</p>
        </div>

        {/* Tabs */}
        <div className="flex bg-[#F7F7F7] p-1 rounded-full mb-6">
          <button
            onClick={() => { setActiveTab('email'); setError(''); }}
            className={`flex-1 py-2 text-[14px] font-semibold rounded-full transition-all ${activeTab === 'email' ? 'bg-white text-[#222222] shadow-[0_1px_3px_rgba(0,0,0,0.08)]' : 'text-[#717171] hover:text-[#222222]'}`}>

            Email
          </button>
          <button
            onClick={() => { setActiveTab('phone'); setError(''); }}
            className={`flex-1 py-2 text-[14px] font-semibold rounded-full transition-all ${activeTab === 'phone' ? 'bg-white text-[#222222] shadow-[0_1px_3px_rgba(0,0,0,0.08)]' : 'text-[#717171] hover:text-[#222222]'}`}>

            Phone
          </button>
        </div>

        {error && (
          <div className="bg-[#FEF2F2] border border-[#FCA5A5] rounded-[8px] px-3 py-2 mb-4 text-[13px] text-[#991B1B]">
            {error}
          </div>
        )}

        {/* Forms */}
        <form onSubmit={handleSubmit}>
          {activeTab === 'email' ?
          <div className="space-y-4">
              <div>
                <label className="block text-[13px] font-semibold text-[#222222] mb-1.5">
                  Email
                </label>
                <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.com"
                className="w-full h-[48px] px-4 border border-[#DDDDDD] rounded-[8px] text-[15px] focus:outline-none focus:border-[#FF385C] focus:ring-1 focus:ring-[#FF385C] transition-colors placeholder:text-[#B0B0B0]" />

              </div>
              <div>
                <label className="block text-[13px] font-semibold text-[#222222] mb-1.5">
                  Password
                </label>
                <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full h-[48px] px-4 border border-[#DDDDDD] rounded-[8px] text-[15px] focus:outline-none focus:border-[#FF385C] focus:ring-1 focus:ring-[#FF385C] transition-colors placeholder:text-[#B0B0B0]" />

              </div>
            </div> :

          <div className="space-y-5">
              <div>
                <label className="block text-[13px] font-semibold text-[#222222] mb-1.5">
                  Phone Number
                </label>
                <input
                type="tel"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+27 82 123 4567"
                className="w-full h-[48px] px-4 border border-[#DDDDDD] rounded-[8px] text-[15px] focus:outline-none focus:border-[#FF385C] focus:ring-1 focus:ring-[#FF385C] transition-colors placeholder:text-[#B0B0B0]" />

              </div>
              <div>
                <label className="block text-[13px] font-semibold text-[#222222] mb-2 text-center">
                  Enter 4-digit PIN
                </label>
                <div className="flex justify-center gap-3">
                  {[0, 1, 2, 3].map((index) =>
                <input
                  key={index}
                  ref={pinRefs[index]}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={pin[index]}
                  onChange={(e) => handlePinChange(index, e.target.value)}
                  onKeyDown={(e) => handlePinKeyDown(index, e)}
                  className="w-[52px] h-[56px] text-center text-[24px] font-bold border border-[#DDDDDD] rounded-[8px] focus:outline-none focus:border-[#FF385C] focus:ring-1 focus:ring-[#FF385C] transition-colors" />

                )}
                </div>
              </div>
            </div>
          }

          <button
            type="submit"
            disabled={loading}
            className="w-full h-[48px] bg-[#FF385C] text-white font-semibold rounded-[8px] mt-6 hover:bg-[#E31C5F] active:bg-[#D70466] transition-colors disabled:opacity-50">

            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        {/* Google Login (Staff only) */}
        {activeTab === 'email' &&
        <>
            <div className="relative flex items-center py-5">
              <div className="flex-grow border-t border-[#EBEBEB]"></div>
              <span className="flex-shrink-0 mx-4 text-[13px] text-[#717171]">
                or
              </span>
              <div className="flex-grow border-t border-[#EBEBEB]"></div>
            </div>

            <button
            type="button"
            onClick={handleGoogleLogin}
            className="w-full h-[48px] bg-white border border-[#DDDDDD] text-[#222222] font-semibold rounded-[8px] flex items-center justify-center gap-2 hover:bg-[#F7F7F7] active:bg-[#F0F0F0] transition-colors">

              <svg width="18" height="18" viewBox="0 0 48 48">
                <path
                fill="#EA4335"
                d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />

                <path
                fill="#4285F4"
                d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />

                <path
                fill="#FBBC05"
                d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />

                <path
                fill="#34A853"
                d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />

              </svg>
              Sign in with Google
            </button>
          </>
        }

        {/* Footer */}
        <div className="mt-6 text-center">
          <p className="text-[13px] text-[#717171]">
            Don't have an account?{' '}
            <a
              href="#"
              className="text-[#FF385C] font-semibold hover:underline">

              Register
            </a>
          </p>
        </div>
      </div>
    </div>);

}
