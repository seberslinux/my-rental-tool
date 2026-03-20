import { useState, useEffect } from 'react';
import { api } from '@/api/client';
import PageHeader from '@/components/PageHeader';
import { PageLoading } from '@/components/LoadingState';
import { Save, Check } from 'lucide-react';

export default function SettingsPage() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [currencies, setCurrencies] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.get<Record<string, unknown>>('/api/settings').then((data) => {
      const { _supported_currencies, ...rest } = data as Record<string, string> & { _supported_currencies?: string[] };
      setSettings(rest);
      setCurrencies(_supported_currencies || ['ZAR', 'EUR', 'USD', 'GBP']);
      setLoading(false);
    });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put('/api/settings', { display_currency: settings.display_currency });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch { /* ignore */ } finally {
      setSaving(false);
    }
  };

  if (loading) return <PageLoading />;

  return (
    <>
      <PageHeader title="Settings">
        <button onClick={handleSave} disabled={saving} className="btn-primary text-sm flex items-center gap-1.5">
          {saved ? <><Check size={14} /> Saved</> : <><Save size={14} /> {saving ? 'Saving...' : 'Save'}</>}
        </button>
      </PageHeader>

      <div className="p-4 md:p-6 max-w-lg">
        <div className="card space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Display currency</label>
            <select
              className="input"
              value={settings.display_currency || 'ZAR'}
              onChange={(e) => setSettings({ ...settings, display_currency: e.target.value })}
            >
              {currencies.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">All monetary values will be displayed in this currency</p>
          </div>
        </div>
      </div>
    </>
  );
}
