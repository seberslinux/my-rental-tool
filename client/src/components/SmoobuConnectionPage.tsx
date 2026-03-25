import React, { useState, useEffect } from 'react';
import { Wifi, WifiOff, RefreshCw, Trash2, CheckCircle, XCircle, ExternalLink, AlertTriangle } from 'lucide-react';

export function SmoobuConnectionPage({ isAdmin = false }: { isAdmin?: boolean }) {
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [apiKey, setApiKey] = useState('');
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [testResult, setTestResult] = useState<{ success: boolean; properties: { id: number; name: string }[] } | null>(null);

  useEffect(() => {
    fetch('/api/settings/smoobu-key', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((d) => setConnected(d.connected))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleTest = async () => {
    if (!apiKey.trim()) return;
    setTesting(true);
    setTestResult(null);
    setMessage(null);
    try {
      const res = await fetch('/api/settings/smoobu-key/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ api_key: apiKey.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        setTestResult({ success: true, properties: data.properties || [] });
        setMessage({ type: 'success', text: `Connected! Found ${data.properties_found} properties.` });
      } else {
        setTestResult(null);
        setMessage({ type: 'error', text: data.error || 'Connection failed' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Connection failed' });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!apiKey.trim()) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/settings/smoobu-key', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ api_key: apiKey.trim() }),
      });
      const data = await res.json();
      if (data.connected) {
        setConnected(true);
        setApiKey('');
        setTestResult(null);
        setMessage({ type: 'success', text: `Smoobu connected! Found ${data.properties_found} properties.` });
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to save' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to save API key' });
    } finally {
      setSaving(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setMessage(null);
    try {
      const res = await fetch('/api/sync/properties', { method: 'POST', credentials: 'same-origin' });
      const data = await res.json();
      if (data.synced !== undefined) {
        setMessage({ type: 'success', text: `Synced ${data.synced} properties from Smoobu.` });
      } else {
        setMessage({ type: 'error', text: data.error || 'Sync failed' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Sync failed' });
    } finally {
      setSyncing(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('Are you sure you want to disconnect Smoobu?')) return;
    setDisconnecting(true);
    setMessage(null);
    try {
      const res = await fetch('/api/settings/smoobu-key', { method: 'DELETE', credentials: 'same-origin' });
      const data = await res.json();
      if (data.connected === false) {
        setConnected(false);
        setMessage({ type: 'success', text: 'Smoobu disconnected.' });
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to disconnect' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to disconnect' });
    } finally {
      setDisconnecting(false);
    }
  };

  const handleResetAndResync = async () => {
    if (!confirm('This will DELETE all bookings and resync everything from Smoobu. Are you sure?')) return;
    setResetting(true);
    setMessage(null);
    try {
      const res = await fetch('/api/analytics/reset-and-resync', { method: 'POST', credentials: 'same-origin' });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: 'success', text: `Reset complete. Synced ${data.properties} properties and ${data.bookings} bookings.` });
      } else {
        setMessage({ type: 'error', text: data.error || 'Reset failed' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Reset failed' });
    } finally {
      setResetting(false);
    }
  };

  if (loading) {
    return (
      <div className="p-4 bg-[#F7F7F7] min-h-full flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-[#007AFF] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 bg-[#F7F7F7] min-h-full">
      {/* Status */}
      <div className="bg-white rounded-[12px] p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] mb-4">
        <div className="flex items-center gap-3 mb-3">
          {connected ?
            <div className="w-10 h-10 rounded-full bg-[#00A699] flex items-center justify-center">
              <Wifi className="w-5 h-5 text-white" strokeWidth={2} />
            </div> :
            <div className="w-10 h-10 rounded-full bg-[#B0B0B0] flex items-center justify-center">
              <WifiOff className="w-5 h-5 text-white" strokeWidth={2} />
            </div>
          }
          <div>
            <div className="text-[16px] font-semibold text-[#222222]">
              {connected ? 'Smoobu Connected' : 'Smoobu Not Connected'}
            </div>
            <div className="text-[13px] text-[#717171]">
              {connected ? 'Your properties are syncing from Smoobu' : 'Connect your Smoobu API key to sync properties'}
            </div>
          </div>
        </div>

        {connected && (
          <div className="flex gap-2 mt-3">
            <button
              onClick={handleSync}
              disabled={syncing}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-[#007AFF] text-white rounded-[8px] text-[14px] font-medium active:bg-[#0066DD] disabled:opacity-50">
              <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} strokeWidth={2} />
              {syncing ? 'Syncing...' : 'Sync Properties'}
            </button>
            <button
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-[#DC2626] text-[#DC2626] rounded-[8px] text-[14px] font-medium active:bg-[#FEF2F2] disabled:opacity-50">
              <Trash2 className="w-4 h-4" strokeWidth={2} />
              {disconnecting ? '...' : 'Disconnect'}
            </button>
          </div>
        )}

        {connected && isAdmin && (
          <div className="mt-3 pt-3 border-t border-[#EBEBEB]">
            <button
              onClick={handleResetAndResync}
              disabled={resetting}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-[#FEF2F2] border border-[#DC2626] text-[#DC2626] rounded-[8px] text-[14px] font-medium active:bg-[#FEE2E2] disabled:opacity-50">
              <AlertTriangle className={`w-4 h-4 ${resetting ? 'animate-pulse' : ''}`} strokeWidth={2} />
              {resetting ? 'Resetting & Resyncing...' : 'Clear Database & Resync from Smoobu'}
            </button>
            <p className="text-[11px] text-[#B0B0B0] mt-1.5 text-center">
              Deletes all bookings and re-imports everything from Smoobu
            </p>
          </div>
        )}
      </div>

      {/* Connect Form (when not connected) */}
      {!connected && (
        <div className="bg-white rounded-[12px] p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] mb-4">
          <h3 className="text-[15px] font-semibold text-[#222222] mb-1">
            Connect Smoobu
          </h3>
          <p className="text-[13px] text-[#717171] mb-4">
            Enter your Smoobu API key. You can find it in your Smoobu account under Settings &gt; API.
          </p>

          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Paste your Smoobu API key"
            className="w-full px-3 py-2.5 bg-[#F7F7F7] border border-[#EBEBEB] rounded-[8px] text-[14px] text-[#222222] placeholder-[#B0B0B0] focus:outline-none focus:ring-1 focus:ring-[#007AFF] focus:border-[#007AFF] mb-3"
          />

          <div className="flex gap-2">
            <button
              onClick={handleTest}
              disabled={!apiKey.trim() || testing}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-[#F7F7F7] border border-[#EBEBEB] text-[#222222] rounded-[8px] text-[14px] font-medium active:bg-[#EBEBEB] disabled:opacity-50">
              {testing ? 'Testing...' : 'Test Connection'}
            </button>
            <button
              onClick={handleSave}
              disabled={!apiKey.trim() || saving}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-[#007AFF] text-white rounded-[8px] text-[14px] font-medium active:bg-[#0066DD] disabled:opacity-50">
              {saving ? 'Saving...' : 'Connect'}
            </button>
          </div>
        </div>
      )}

      {/* Test Result */}
      {testResult && testResult.success && (
        <div className="bg-white rounded-[12px] p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] mb-4">
          <h3 className="text-[15px] font-semibold text-[#222222] mb-3">
            Properties Found
          </h3>
          <div className="space-y-2">
            {testResult.properties.map((p) => (
              <div key={p.id} className="flex items-center gap-2 text-[14px] text-[#222222]">
                <CheckCircle className="w-4 h-4 text-[#00A699]" strokeWidth={2} />
                {p.name}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Message */}
      {message && (
        <div className={`rounded-[8px] p-3 flex items-start gap-2 mb-4 ${message.type === 'success' ? 'bg-[#F0FAF9] text-[#00A699]' : 'bg-[#FEF2F2] text-[#DC2626]'}`}>
          {message.type === 'success' ?
            <CheckCircle className="w-4 h-4 mt-0.5 shrink-0" strokeWidth={2} /> :
            <XCircle className="w-4 h-4 mt-0.5 shrink-0" strokeWidth={2} />
          }
          <span className="text-[13px] font-medium">{message.text}</span>
        </div>
      )}

      {/* Help */}
      <div className="bg-white rounded-[12px] p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)]">
        <h3 className="text-[15px] font-semibold text-[#222222] mb-2">
          How to get your API key
        </h3>
        <ol className="text-[13px] text-[#717171] space-y-2 list-decimal list-inside">
          <li>Log in to your Smoobu account</li>
          <li>Go to Settings &gt; API &amp; Integrations</li>
          <li>Copy your API key</li>
          <li>Paste it above and click Connect</li>
        </ol>
      </div>
    </div>
  );
}
