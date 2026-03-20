import { useState } from 'react';
import { api } from '@/api/client';
import { useApi } from '@/hooks/useApi';
import type { Property, PropertySummary } from '@/types';
import PageHeader from '@/components/PageHeader';
import { PageLoading, ErrorState, EmptyState } from '@/components/LoadingState';
import { RefreshCw, Building2, ChevronRight, X, ExternalLink, Wifi, Key, Clock, Save } from 'lucide-react';

export default function PropertiesPage() {
  const { data: properties, loading, error, refetch } = useApi<Property[]>('/api/properties');
  const [syncing, setSyncing] = useState(false);
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null);
  const [showDetail, setShowDetail] = useState(false);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await api.post('/api/sync/properties');
      await refetch();
    } catch { /* ignore */ } finally {
      setSyncing(false);
    }
  };

  if (loading) return <PageLoading />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  return (
    <>
      <PageHeader title="Properties">
        <button onClick={handleSync} disabled={syncing} className="btn-secondary text-sm flex items-center gap-1.5">
          <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
          Sync
        </button>
      </PageHeader>

      <div className="p-4 md:p-6">
        {!properties || properties.length === 0 ? (
          <EmptyState message="No properties. Click Sync to import from Smoobu." />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {properties.map((p) => (
              <button
                key={p.id}
                onClick={() => { setSelectedProperty(p); setShowDetail(true); }}
                className="card text-left hover:border-primary-300 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 bg-primary-50 rounded-lg flex items-center justify-center text-primary-600 flex-shrink-0">
                    <Building2 size={20} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-gray-900 truncate">{p.name}</h3>
                    {p.address && <p className="text-xs text-gray-500 truncate mt-0.5">{p.address}</p>}
                    <div className="flex flex-wrap gap-2 mt-2 text-xs text-gray-500">
                      {p.bedrooms != null && <span>{p.bedrooms} bed</span>}
                      {p.bathrooms != null && <span>{p.bathrooms} bath</span>}
                      {p.max_guests != null && <span>{p.max_guests} guests</span>}
                    </div>
                  </div>
                  <ChevronRight size={16} className="text-gray-400 flex-shrink-0 mt-1" />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {showDetail && selectedProperty && (
        <PropertyDetailSheet
          property={selectedProperty}
          onClose={() => setShowDetail(false)}
          onSaved={() => { setShowDetail(false); refetch(); }}
        />
      )}
    </>
  );
}

function PropertyDetailSheet({ property, onClose, onSaved }: {
  property: Property;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { data: summary } = useApi<PropertySummary>(`/api/properties/${property.id}/summary`);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ ...property });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      await api.put(`/api/properties/${property.id}`, {
        address: form.address,
        cleaning_hours_required: form.cleaning_hours_required,
        base_price: form.base_price,
        base_currency: form.base_currency,
        airbnb_url: form.airbnb_url,
        booking_url: form.booking_url,
        vrbo_url: form.vrbo_url,
        airbnb_commission: form.airbnb_commission,
        booking_commission: form.booking_commission,
        vrbo_commission: form.vrbo_commission,
        vat_rate: form.vat_rate,
        property_type: form.property_type,
        bedrooms: form.bedrooms,
        bathrooms: form.bathrooms,
        max_guests: form.max_guests,
        location: form.location,
        neighbourhood: form.neighbourhood,
        wifi_network: form.wifi_network,
        wifi_password: form.wifi_password,
        access_code: form.access_code,
        check_in_instructions: form.check_in_instructions,
        check_in_time: form.check_in_time,
        check_out_time: form.check_out_time,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div className="relative w-full max-w-lg bg-white shadow-xl h-full overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between z-10">
          <h3 className="font-semibold text-gray-900">{property.name}</h3>
          <div className="flex items-center gap-2">
            {!editing ? (
              <button onClick={() => setEditing(true)} className="btn-secondary text-xs">Edit</button>
            ) : (
              <button onClick={handleSave} disabled={saving} className="btn-primary text-xs flex items-center gap-1">
                <Save size={12} /> {saving ? 'Saving...' : 'Save'}
              </button>
            )}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
          </div>
        </div>

        <div className="p-4 space-y-6">
          {error && <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-lg">{error}</div>}

          {/* KPIs from summary */}
          {summary?.kpis && (
            <div className="grid grid-cols-2 gap-3">
              <MiniKpi label="Revenue (30d)" value={`R${Math.round(summary.kpis.revenue_30d).toLocaleString()}`} />
              <MiniKpi label="Occupancy (30d)" value={`${Math.round(summary.kpis.occupancy_30d)}%`} />
              <MiniKpi label="Avg rate (30d)" value={`R${Math.round(summary.kpis.avg_nightly_rate_30d).toLocaleString()}`} />
              <MiniKpi label="Net profit (30d)" value={`R${Math.round(summary.kpis.net_profit_30d).toLocaleString()}`} />
            </div>
          )}

          {/* Property details */}
          <Section title="Listing details">
            <Field label="Address" value={form.address} editing={editing} onChange={(v) => setForm({ ...form, address: v })} />
            <div className="grid grid-cols-3 gap-3">
              <Field label="Bedrooms" value={form.bedrooms?.toString()} editing={editing} type="number" onChange={(v) => setForm({ ...form, bedrooms: Number(v) })} />
              <Field label="Bathrooms" value={form.bathrooms?.toString()} editing={editing} type="number" onChange={(v) => setForm({ ...form, bathrooms: Number(v) })} />
              <Field label="Max guests" value={form.max_guests?.toString()} editing={editing} type="number" onChange={(v) => setForm({ ...form, max_guests: Number(v) })} />
            </div>
          </Section>

          <Section title="Check-in / Check-out">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Check-in time" value={form.check_in_time} editing={editing} onChange={(v) => setForm({ ...form, check_in_time: v })} />
              <Field label="Check-out time" value={form.check_out_time} editing={editing} onChange={(v) => setForm({ ...form, check_out_time: v })} />
            </div>
            <Field label="Access code" value={form.access_code} editing={editing} onChange={(v) => setForm({ ...form, access_code: v })} />
            <Field label="Check-in instructions" value={form.check_in_instructions} editing={editing} multiline onChange={(v) => setForm({ ...form, check_in_instructions: v })} />
          </Section>

          <Section title="WiFi">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Network" value={form.wifi_network} editing={editing} onChange={(v) => setForm({ ...form, wifi_network: v })} />
              <Field label="Password" value={form.wifi_password} editing={editing} onChange={(v) => setForm({ ...form, wifi_password: v })} />
            </div>
          </Section>

          <Section title="Commissions & Fees">
            <div className="grid grid-cols-3 gap-3">
              <Field label="Airbnb %" value={form.airbnb_commission?.toString()} editing={editing} type="number" onChange={(v) => setForm({ ...form, airbnb_commission: Number(v) })} />
              <Field label="Booking %" value={form.booking_commission?.toString()} editing={editing} type="number" onChange={(v) => setForm({ ...form, booking_commission: Number(v) })} />
              <Field label="VAT %" value={form.vat_rate?.toString()} editing={editing} type="number" onChange={(v) => setForm({ ...form, vat_rate: Number(v) })} />
            </div>
          </Section>

          <Section title="Listing URLs">
            <Field label="Airbnb" value={form.airbnb_url} editing={editing} onChange={(v) => setForm({ ...form, airbnb_url: v })} />
            <Field label="Booking.com" value={form.booking_url} editing={editing} onChange={(v) => setForm({ ...form, booking_url: v })} />
            <Field label="VRBO" value={form.vrbo_url} editing={editing} onChange={(v) => setForm({ ...form, vrbo_url: v })} />
          </Section>

          {/* Upcoming bookings */}
          {summary?.upcoming_bookings && summary.upcoming_bookings.length > 0 && (
            <Section title="Upcoming bookings">
              {summary.upcoming_bookings.slice(0, 5).map((b) => (
                <div key={b.id} className="flex justify-between py-1.5 text-sm border-b border-gray-50 last:border-0">
                  <span className="text-gray-900">{b.guest_name}</span>
                  <span className="text-gray-500">{new Date(b.check_in).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })}</span>
                </div>
              ))}
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-sm font-semibold text-gray-700 mb-3">{title}</h4>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Field({ label, value, editing, type = 'text', multiline, onChange }: {
  label: string; value?: string; editing: boolean; type?: string; multiline?: boolean;
  onChange?: (v: string) => void;
}) {
  if (!editing) {
    return (
      <div>
        <p className="text-xs text-gray-500">{label}</p>
        <p className="text-sm text-gray-900">{value || '-'}</p>
      </div>
    );
  }
  if (multiline) {
    return (
      <div>
        <label className="block text-xs text-gray-500 mb-1">{label}</label>
        <textarea className="input" rows={3} value={value || ''} onChange={(e) => onChange?.(e.target.value)} />
      </div>
    );
  }
  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      <input className="input" type={type} value={value || ''} onChange={(e) => onChange?.(e.target.value)} />
    </div>
  );
}

function MiniKpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-50 rounded-lg p-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-lg font-bold text-gray-900">{value}</p>
    </div>
  );
}
