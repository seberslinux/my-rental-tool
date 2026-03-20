import { useState, useEffect } from 'react';
import { api } from '@/api/client';
import type { Cleaner, CleaningJob, Property, PaySummary } from '@/types';
import PageHeader from '@/components/PageHeader';
import { PageLoading, ErrorState, EmptyState } from '@/components/LoadingState';
import { Plus, Phone, Mail, Clock, DollarSign, Check, X, Edit2, Trash2, Calendar } from 'lucide-react';

const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });
}

export default function CleanersPage() {
  const [cleaners, setCleaners] = useState<Cleaner[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'list' | 'schedule' | 'pay'>('list');
  const [showForm, setShowForm] = useState(false);
  const [editCleaner, setEditCleaner] = useState<Cleaner | null>(null);
  const [payMonth, setPayMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [paySummary, setPaySummary] = useState<PaySummary | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const [c, p] = await Promise.all([
        api.get<Cleaner[]>('/api/cleaners'),
        api.get<Property[]>('/api/properties'),
      ]);
      setCleaners(c);
      setProperties(p);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  const loadPay = async () => {
    try {
      const data = await api.get<PaySummary>(`/api/cleaners/pay-summary?month=${payMonth}`);
      setPaySummary(data);
    } catch { /* ignore */ }
  };

  useEffect(() => { loadData(); }, []);
  useEffect(() => { if (tab === 'pay') loadPay(); }, [tab, payMonth]);

  const deleteCleaner = async (id: number) => {
    if (!confirm('Delete this cleaner?')) return;
    await api.delete(`/api/cleaners/${id}`);
    loadData();
  };

  if (loading) return <PageLoading />;
  if (error) return <ErrorState message={error} onRetry={loadData} />;

  return (
    <>
      <PageHeader title="Cleaners">
        <button onClick={() => { setEditCleaner(null); setShowForm(true); }} className="btn-primary text-sm flex items-center gap-1.5">
          <Plus size={14} /> Add cleaner
        </button>
      </PageHeader>

      <div className="p-4 md:p-6">
        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
          {(['list', 'schedule', 'pay'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {t === 'list' ? 'Cleaners' : t === 'schedule' ? 'Schedule' : 'Pay'}
            </button>
          ))}
        </div>

        {tab === 'list' && (
          <div className="grid gap-4 md:grid-cols-2">
            {cleaners.length === 0 ? (
              <EmptyState message="No cleaners added yet" />
            ) : cleaners.map((c) => (
              <div key={c.id} className="card">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-gray-900">{c.name}</h3>
                    <div className="flex items-center gap-3 mt-1 text-sm text-gray-500">
                      {c.phone && <span className="flex items-center gap-1"><Phone size={12} /> {c.phone}</span>}
                      {c.email && <span className="flex items-center gap-1"><Mail size={12} /> {c.email}</span>}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => { setEditCleaner(c); setShowForm(true); }} className="p-1.5 text-gray-400 hover:text-gray-600 rounded">
                      <Edit2 size={14} />
                    </button>
                    <button onClick={() => deleteCleaner(c.id)} className="p-1.5 text-gray-400 hover:text-red-600 rounded">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {c.properties?.map((p) => (
                    <span key={p.id} className="badge bg-primary-50 text-primary-700">{p.name}</span>
                  ))}
                </div>
                <div className="mt-3 flex items-center gap-4 text-xs text-gray-500">
                  <span className="flex items-center gap-1">
                    <DollarSign size={12} />
                    {c.rate_type === 'flat' ? `R${c.flat_rate} flat` : `R${c.hourly_rate}/hr`}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock size={12} />
                    {c.availability?.map((a) => DAY_NAMES[a.day_of_week]).join(', ') || 'No schedule'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'schedule' && (
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 pr-4 font-semibold text-gray-700">Cleaner</th>
                  {DAY_NAMES.map((d) => (
                    <th key={d} className="text-center py-2 px-2 font-semibold text-gray-700">{d}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cleaners.map((c) => (
                  <tr key={c.id} className="border-b border-gray-50">
                    <td className="py-2 pr-4 font-medium text-gray-900">{c.name}</td>
                    {[0, 1, 2, 3, 4, 5, 6].map((dow) => {
                      const avail = c.availability?.find((a) => a.day_of_week === dow);
                      return (
                        <td key={dow} className="text-center py-2 px-2">
                          {avail ? (
                            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-green-100 text-green-600">
                              <Check size={14} />
                            </span>
                          ) : (
                            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-gray-100 text-gray-400">
                              <X size={14} />
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'pay' && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <input
                type="month"
                value={payMonth}
                onChange={(e) => setPayMonth(e.target.value)}
                className="input w-auto"
              />
            </div>
            {paySummary ? (
              <>
                <div className="card">
                  <div className="flex justify-between items-center">
                    <h3 className="font-semibold text-gray-900">Total</h3>
                    <span className="text-xl font-bold text-gray-900">R{paySummary.grand_total.toLocaleString()}</span>
                  </div>
                </div>
                {paySummary.cleaners.map((c) => (
                  <div key={c.cleaner_id} className="card">
                    <div className="flex justify-between items-center mb-3">
                      <h3 className="font-semibold text-gray-900">{c.cleaner_name}</h3>
                      <span className="font-semibold text-gray-700">R{c.subtotal.toLocaleString()}</span>
                    </div>
                    {c.jobs.length > 0 ? (
                      <div className="space-y-1.5">
                        {c.jobs.map((j: CleaningJob) => (
                          <div key={j.id} className="flex justify-between text-sm text-gray-600">
                            <span>{j.property_name} · {formatDate(j.cleaning_date)}</span>
                            <span className={`capitalize ${j.status === 'completed' ? 'text-green-600' : 'text-gray-400'}`}>
                              {j.status}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-gray-400">No jobs this month</p>
                    )}
                  </div>
                ))}
              </>
            ) : (
              <EmptyState message="No pay data for this month" />
            )}
          </div>
        )}
      </div>

      {/* Add/Edit Cleaner Modal */}
      {showForm && (
        <CleanerFormModal
          cleaner={editCleaner}
          properties={properties}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); loadData(); }}
        />
      )}
    </>
  );
}

function CleanerFormModal({ cleaner, properties, onClose, onSaved }: {
  cleaner: Cleaner | null;
  properties: Property[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!cleaner;
  const [form, setForm] = useState({
    name: cleaner?.name || '',
    phone: cleaner?.phone || '',
    email: cleaner?.email || '',
    rate_type: cleaner?.rate_type || 'flat',
    hourly_rate: cleaner?.hourly_rate?.toString() || '',
    flat_rate: cleaner?.flat_rate?.toString() || '',
    notes: cleaner?.notes || '',
    pin: '',
    property_ids: cleaner?.properties?.map((p) => p.id) || [],
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const body: Record<string, unknown> = {
        name: form.name,
        phone: form.phone,
        email: form.email || undefined,
        rate_type: form.rate_type,
        hourly_rate: form.hourly_rate ? Number(form.hourly_rate) : undefined,
        flat_rate: form.flat_rate ? Number(form.flat_rate) : undefined,
        notes: form.notes || undefined,
        property_ids: form.property_ids,
      };
      if (form.pin) body.pin = form.pin;

      if (isEdit) {
        await api.put(`/api/cleaners/${cleaner!.id}`, body);
      } else {
        await api.post('/api/cleaners', body);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const toggleProperty = (id: number) => {
    setForm((f) => ({
      ...f,
      property_ids: f.property_ids.includes(id)
        ? f.property_ids.filter((p) => p !== id)
        : [...f.property_ids, id],
    }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-gray-200 px-5 py-4 flex items-center justify-between rounded-t-xl">
          <h3 className="font-semibold text-gray-900">{isEdit ? 'Edit cleaner' : 'Add cleaner'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-lg">{error}</div>}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Phone *</label>
            <input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+27..." required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Rate type</label>
              <select className="input" value={form.rate_type} onChange={(e) => setForm({ ...form, rate_type: e.target.value as 'flat' | 'hourly' })}>
                <option value="flat">Flat rate</option>
                <option value="hourly">Hourly</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {form.rate_type === 'flat' ? 'Flat rate (R)' : 'Hourly rate (R)'}
              </label>
              <input
                className="input"
                type="number"
                value={form.rate_type === 'flat' ? form.flat_rate : form.hourly_rate}
                onChange={(e) => setForm({
                  ...form,
                  [form.rate_type === 'flat' ? 'flat_rate' : 'hourly_rate']: e.target.value,
                })}
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">PIN (4 digits)</label>
            <input className="input" type="text" maxLength={4} pattern="\d{4}" value={form.pin} onChange={(e) => setForm({ ...form, pin: e.target.value })} placeholder={isEdit ? 'Leave blank to keep' : '1234'} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Properties</label>
            <div className="flex flex-wrap gap-2">
              {properties.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => toggleProperty(p.id)}
                  className={`badge cursor-pointer ${
                    form.property_ids.includes(p.id) ? 'bg-primary-100 text-primary-700 border border-primary-300' : 'bg-gray-100 text-gray-600 border border-gray-200'
                  }`}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea className="input" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary flex-1">
              {saving ? 'Saving...' : isEdit ? 'Save changes' : 'Add cleaner'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
