import React, { useState, useEffect, useCallback } from 'react';
import {
  ChevronDown,
  ChevronRight,
  MapPin,
  Bed,
  DollarSign,
  Link,
  Percent,
  MessageSquare,
  BarChart2,
  Save,
  RefreshCw,
  Sparkles,
  User,
  Cloud,
  Wifi,
  Globe,
  Users,
  X,
  Plus } from
'lucide-react';

interface Property {
  id: number;
  smoobu_id: number;
  name: string;
  address: string;
  cleaning_hours_required: number | null;
  base_price: number | null;
  base_currency: string | null;
  airbnb_url: string | null;
  booking_url: string | null;
  vrbo_url: string | null;
  commission_airbnb: number | null;
  commission_booking: number | null;
  commission_vrbo: number | null;
  bank_charge_airbnb: number | null;
  bank_charge_booking: number | null;
  bank_charge_vrbo: number | null;
  vat_rate: number | null;
  property_type: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  max_guests: number | null;
  location: string | null;
  neighbourhood: string | null;
  wifi_network: string | null;
  wifi_password: string | null;
  access_code: string | null;
  check_in_instructions: string | null;
  check_in_time: string | null;
  check_out_time: string | null;
}

// Local editable state per property
interface PropertyForm {
  cleaning_hours_required: number;
  airbnb_url: string;
  booking_url: string;
  vrbo_url: string;
  commission_airbnb: number;
  commission_booking: number;
  commission_vrbo: number;
  bank_charge_airbnb: number;
  bank_charge_booking: number;
  bank_charge_vrbo: number;
  vat_rate: number;
  check_in_time: string;
  check_out_time: string;
  wifi_network: string;
  wifi_password: string;
  check_in_instructions: string;
}

function buildForm(p: Property): PropertyForm {
  return {
    cleaning_hours_required: p.cleaning_hours_required ?? 0,
    airbnb_url: p.airbnb_url ?? '',
    booking_url: p.booking_url ?? '',
    vrbo_url: p.vrbo_url ?? '',
    commission_airbnb: p.commission_airbnb ?? 0,
    commission_booking: p.commission_booking ?? 0,
    commission_vrbo: p.commission_vrbo ?? 0,
    bank_charge_airbnb: p.bank_charge_airbnb ?? 0,
    bank_charge_booking: p.bank_charge_booking ?? 0,
    bank_charge_vrbo: p.bank_charge_vrbo ?? 0,
    vat_rate: p.vat_rate ?? 0,
    check_in_time: p.check_in_time ?? '',
    check_out_time: p.check_out_time ?? '',
    wifi_network: p.wifi_network ?? '',
    wifi_password: p.wifi_password ?? '',
    check_in_instructions: p.check_in_instructions ?? '',
  };
}

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  if (isNaN(diffMs)) return dateStr;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function Section({
  icon: Icon,
  title,
  children,
  defaultOpen = false
}: {icon: React.ElementType;title: string;children: React.ReactNode;defaultOpen?: boolean;}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-[#F0F0F0] last:border-b-0">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between py-3 text-left">

        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-[#717171]" />
          <span className="text-[13px] md:text-[14px] font-semibold text-[#222222]">
            {title}
          </span>
        </div>
        {open ?
        <ChevronDown className="w-4 h-4 text-[#B0B0B0]" /> :

        <ChevronRight className="w-4 h-4 text-[#B0B0B0]" />
        }
      </button>
      {open && <div className="pb-4">{children}</div>}
    </div>);

}
function SyncBadge() {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#00A699] bg-[#00A69910] px-1.5 py-0.5 rounded-full">
      <Cloud className="w-2.5 h-2.5" />
      Smoobu
    </span>);

}
const inputCls =
'w-full h-9 px-3 border border-[#EBEBEB] rounded-[8px] text-[13px] focus:outline-none focus:border-[#007AFF] focus:ring-1 focus:ring-[#007AFF]';
export function PropertiesPage() {
  const [expandedProperty, setExpandedProperty] = useState<number | null>(null);
  const [properties, setProperties] = useState<Property[]>([]);
  const [forms, setForms] = useState<Record<number, PropertyForm>>({});
  const [syncing, setSyncing] = useState(false);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProperties = useCallback(async () => {
    try {
      const res = await fetch('/api/properties', { credentials: 'same-origin' });
      if (!res.ok) throw new Error('Failed to fetch properties');
      const data: Property[] = await res.json();
      setProperties(data);
      const newForms: Record<number, PropertyForm> = {};
      data.forEach((p) => { newForms[p.id] = buildForm(p); });
      setForms(newForms);
      if (data.length > 0 && expandedProperty === null) {
        setExpandedProperty(data[0].id);
      }
    } catch (err) {
      console.error('Error fetching properties:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchProperties(); }, [fetchProperties]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch('/api/sync/properties', {
        method: 'POST',
        credentials: 'same-origin',
      });
      if (!res.ok) throw new Error('Sync failed');
      setLastSynced(new Date().toISOString());
      await fetchProperties();
    } catch (err) {
      console.error('Error syncing:', err);
    } finally {
      setSyncing(false);
    }
  };

  const handleSave = async (propId: number) => {
    const form = forms[propId];
    if (!form) return;
    setSavingId(propId);
    try {
      const res = await fetch(`/api/properties/${propId}`, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error('Save failed');
      await fetchProperties();
    } catch (err) {
      console.error('Error saving property:', err);
    } finally {
      setSavingId(null);
    }
  };

  const updateForm = (propId: number, field: keyof PropertyForm, value: string | number) => {
    setForms((prev) => ({
      ...prev,
      [propId]: { ...prev[propId], [field]: value },
    }));
  };

  const toggleProperty = (id: number) => {
    setExpandedProperty(expandedProperty === id ? null : id);
  };

  if (loading) {
    return (
      <div className="p-4 md:p-6 max-w-[1200px] mx-auto">
        <p className="text-[13px] text-[#717171]">Loading properties...</p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-[1200px] mx-auto space-y-3 md:space-y-4 pb-28">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white rounded-[10px] p-3 md:p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] border border-[#EBEBEB]">
        <div>
          <p className="text-[12px] md:text-[13px] text-[#717171]">
            Sync properties from Smoobu first, then configure settings below.
          </p>
          <p className="text-[10px] text-[#B0B0B0] mt-0.5">
            Last synced: {lastSynced ? relativeTime(lastSynced) : 'never'}
          </p>
        </div>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-[12px] md:text-[13px] font-semibold text-[#007AFF] bg-[#F0F9FF] border border-[#007AFF30] rounded-[8px] hover:bg-[#E0F2FE] transition-colors whitespace-nowrap disabled:opacity-50">
          <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? 'Syncing...' : 'Sync from Smoobu'}
        </button>
      </div>

      {/* Property Cards */}
      <div className="space-y-3">
        {properties.map((prop) => {
          const isExpanded = expandedProperty === prop.id;
          const form = forms[prop.id];
          return (
            <div
              key={prop.id}
              className="bg-white rounded-[10px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] border border-[#EBEBEB] overflow-hidden">

              {/* Card Header */}
              <div
                className={`p-3 md:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 cursor-pointer hover:bg-[#FAFAFA] transition-colors ${isExpanded ? 'border-b border-[#EBEBEB]' : ''}`}
                onClick={() => toggleProperty(prop.id)}>

                <div className="flex items-center gap-2.5">
                  <div className="text-[#B0B0B0]">
                    {isExpanded ?
                    <ChevronDown className="w-4 h-4" /> :

                    <ChevronRight className="w-4 h-4" />
                    }
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-[15px] md:text-[16px] font-bold text-[#222222]">
                        {prop.name}
                      </h2>
                      {prop.property_type &&
                      <span className="text-[11px] text-[#717171] bg-[#F7F7F7] px-1.5 py-0.5 rounded">
                          {prop.property_type}
                        </span>
                      }
                    </div>
                    <p className="text-[11px] text-[#B0B0B0]">
                      ID: {prop.smoobu_id}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 pl-7 sm:pl-0">
                  <button
                    className="flex items-center gap-1 text-[12px] font-semibold text-[#007AFF] hover:underline"
                    onClick={(e) => e.stopPropagation()}>

                    <BarChart2 className="w-3.5 h-3.5" />
                    Performance
                  </button>
                  <button
                    className="flex items-center gap-1 px-3 py-1.5 text-[12px] font-semibold text-white bg-[#007AFF] rounded-[6px] hover:bg-[#0066CC]"
                    onClick={(e) => { e.stopPropagation(); handleSave(prop.id); }}
                    disabled={savingId === prop.id}>

                    <Save className="w-3.5 h-3.5" />
                    {savingId === prop.id ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </div>

              {/* Expanded Content */}
              {isExpanded && form &&
              <div className="p-3 md:p-4">
                  {/* Compact Smoobu Summary */}
                  <div className="bg-[#F7F7F7] rounded-[8px] p-3 mb-3">
                    <div className="flex items-center gap-2 mb-2">
                      <SyncBadge />
                      <span className="text-[10px] text-[#B0B0B0]">
                        Read-only from Smoobu
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-[#222222] mb-2">
                      <span>
                        <span className="text-[#B0B0B0]">Beds:</span>{' '}
                        {prop.bedrooms ?? '—'}
                      </span>
                      <span>
                        <span className="text-[#B0B0B0]">Baths:</span>{' '}
                        {prop.bathrooms ?? '—'}
                      </span>
                      <span>
                        <span className="text-[#B0B0B0]">Guests:</span>{' '}
                        {prop.max_guests ?? '—'}
                      </span>
                      <span>
                        <span className="text-[#B0B0B0]">Price:</span>{' '}
                        {prop.base_price != null
                          ? `${prop.base_currency === 'ZAR' ? 'R' : (prop.base_currency ?? '')} ${prop.base_price.toLocaleString()}`
                          : '—'}
                      </span>
                      <span>
                        <span className="text-[#B0B0B0]">Currency:</span>{' '}
                        {prop.base_currency ?? '—'}
                      </span>
                    </div>
                    <div className="text-[11px] text-[#717171] flex items-center gap-1">
                      <MapPin className="w-3 h-3" />
                      {prop.address || '—'}
                    </div>

                    {/* Expandable details */}
                    <SmoobuDetails prop={prop} />
                  </div>

                  {/* Editable Settings */}
                  <div>
                    <Section
                    icon={Sparkles}
                    title="Cleaning"
                    defaultOpen={true}>

                      <div className="w-full sm:w-48">
                        <label className="block text-[11px] font-medium text-[#222222] mb-1">
                          Cleaning Hours Required
                        </label>
                        <input
                        type="number"
                        step="0.5"
                        value={form.cleaning_hours_required}
                        onChange={(e) => updateForm(prop.id, 'cleaning_hours_required', parseFloat(e.target.value) || 0)}
                        className={inputCls} />

                      </div>
                    </Section>

                    <Section
                    icon={Link}
                    title="Platform Listings"
                    defaultOpen={true}>

                      <p className="text-[11px] text-[#B0B0B0] mb-3">
                        URLs for review scraping and market comparison
                      </p>
                      <div className="space-y-3">
                        {([
                      {
                        label: 'Airbnb',
                        urlField: 'airbnb_url' as const,
                        urlPh: 'https://www.airbnb.com/rooms/...',
                      },
                      {
                        label: 'Booking.com',
                        urlField: 'booking_url' as const,
                        urlPh: 'https://www.booking.com/hotel/...',
                      },
                      {
                        label: 'VRBO',
                        urlField: 'vrbo_url' as const,
                        urlPh: 'https://www.vrbo.com/...',
                      }]).
                      map((p) =>
                      <div
                        key={p.label}
                        className="grid grid-cols-1 sm:grid-cols-2 gap-2">

                            <div>
                              <label className="block text-[11px] font-medium text-[#222222] mb-1">
                                {p.label} URL
                              </label>
                              <input
                            type="text"
                            placeholder={p.urlPh}
                            value={form[p.urlField]}
                            onChange={(e) => updateForm(prop.id, p.urlField, e.target.value)}
                            className={inputCls} />

                            </div>
                          </div>
                      )}
                      </div>
                    </Section>

                    <Section icon={Percent} title="Commissions, Charges & Tax">
                      <p className="text-[11px] text-[#B0B0B0] mb-3">
                        Used to estimate platform fees in the P&L view
                      </p>

                      <div className="text-[11px] font-semibold text-[#717171] uppercase tracking-[0.3px] mb-2">
                        Commissions
                      </div>
                      <div className="grid grid-cols-3 gap-2 mb-3">
                        {([
                      {
                        l: 'Airbnb %',
                        field: 'commission_airbnb' as const,
                      },
                      {
                        l: 'Booking.com %',
                        field: 'commission_booking' as const,
                      },
                      {
                        l: 'VRBO %',
                        field: 'commission_vrbo' as const,
                      }]).
                      map((c) =>
                      <div key={c.l}>
                            <label className="block text-[11px] font-medium text-[#222222] mb-1">
                              {c.l}
                            </label>
                            <input
                          type="number"
                          value={form[c.field]}
                          onChange={(e) => updateForm(prop.id, c.field, parseFloat(e.target.value) || 0)}
                          className={inputCls} />

                          </div>
                      )}
                      </div>

                      <div className="text-[11px] font-semibold text-[#717171] uppercase tracking-[0.3px] mb-2">
                        Bank Charges
                      </div>
                      <div className="grid grid-cols-3 gap-2 mb-3">
                        {([
                      {
                        l: 'Airbnb %',
                        field: 'bank_charge_airbnb' as const,
                      },
                      {
                        l: 'Booking.com %',
                        field: 'bank_charge_booking' as const,
                      },
                      {
                        l: 'VRBO %',
                        field: 'bank_charge_vrbo' as const,
                      }]).
                      map((c) =>
                      <div key={c.l + 'bank'}>
                            <label className="block text-[11px] font-medium text-[#222222] mb-1">
                              {c.l}
                            </label>
                            <input
                          type="number"
                          value={form[c.field]}
                          onChange={(e) => updateForm(prop.id, c.field, parseFloat(e.target.value) || 0)}
                          step="0.1"
                          className={inputCls} />

                          </div>
                      )}
                      </div>

                      <div className="text-[11px] font-semibold text-[#717171] uppercase tracking-[0.3px] mb-2">
                        Tax
                      </div>
                      <div className="w-full sm:w-48">
                        <label className="block text-[11px] font-medium text-[#222222] mb-1">
                          VAT Rate %
                        </label>
                        <input
                        type="number"
                        value={form.vat_rate}
                        onChange={(e) => updateForm(prop.id, 'vat_rate', parseFloat(e.target.value) || 0)}
                        className={inputCls} />

                        <p className="text-[10px] text-[#B0B0B0] mt-1 leading-tight">
                          VAT charged on top of commissions + bank charges (e.g. 15 for SA VAT)
                        </p>
                      </div>
                    </Section>

                    <Section icon={MessageSquare} title="Monthly Fixed Costs">
                      <p className="text-[12px] text-[#717171] mb-1">
                        No fixed costs configured.
                      </p>
                      <button className="text-[12px] font-medium text-[#007AFF] hover:underline">
                        Edit in Finances → Cost Settings
                      </button>
                    </Section>

                    <Section icon={User} title="Guest & Operations Info">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[11px] font-medium text-[#222222] mb-1">
                            Check-in Time
                          </label>
                          <input
                          type="text"
                          placeholder="e.g. 15:00"
                          value={form.check_in_time}
                          onChange={(e) => updateForm(prop.id, 'check_in_time', e.target.value)}
                          className={inputCls} />

                        </div>
                        <div>
                          <label className="block text-[11px] font-medium text-[#222222] mb-1">
                            Check-out Time
                          </label>
                          <input
                          type="text"
                          placeholder="e.g. 10:00"
                          value={form.check_out_time}
                          onChange={(e) => updateForm(prop.id, 'check_out_time', e.target.value)}
                          className={inputCls} />

                        </div>
                        <div>
                          <label className="block text-[11px] font-medium text-[#222222] mb-1">
                            WiFi Name
                          </label>
                          <input
                          type="text"
                          placeholder="Network name"
                          value={form.wifi_network}
                          onChange={(e) => updateForm(prop.id, 'wifi_network', e.target.value)}
                          className={inputCls} />

                        </div>
                        <div>
                          <label className="block text-[11px] font-medium text-[#222222] mb-1">
                            WiFi Password
                          </label>
                          <input
                          type="text"
                          placeholder="Password"
                          value={form.wifi_password}
                          onChange={(e) => updateForm(prop.id, 'wifi_password', e.target.value)}
                          className={inputCls} />

                        </div>
                      </div>
                      <div className="mt-3">
                        <label className="block text-[11px] font-medium text-[#222222] mb-1">
                          House Rules / Notes
                        </label>
                        <textarea
                        placeholder="e.g. No smoking, quiet hours after 22:00..."
                        value={form.check_in_instructions}
                        onChange={(e) => updateForm(prop.id, 'check_in_instructions', e.target.value)}
                        className="w-full h-16 p-2 border border-[#EBEBEB] rounded-[8px] text-[13px] focus:outline-none focus:border-[#007AFF] focus:ring-1 focus:ring-[#007AFF] resize-none" />

                      </div>
                    </Section>
                  </div>

                  {/* Sharing */}
                  <Section icon={Users} title="Sharing">
                    <PropertySharing propertyId={prop.id} />
                  </Section>

                  {/* Save Button */}
                  <div className="flex justify-end pt-3">
                    <button
                      onClick={() => handleSave(prop.id)}
                      disabled={savingId === prop.id}
                      className="flex items-center gap-1.5 px-4 py-2 text-[12px] md:text-[13px] font-semibold text-white bg-[#007AFF] rounded-[8px] hover:bg-[#0066CC] disabled:opacity-50">
                      <Save className="w-3.5 h-3.5" />
                      {savingId === prop.id ? 'Saving...' : 'Save Settings'}
                    </button>
                  </div>
                </div>
              }
            </div>);

        })}
      </div>

      {/* Floating Action Bar */}
      <div className="fixed bottom-[64px] left-0 right-0 bg-white border-t border-[#EBEBEB] shadow-[0_-2px_4px_rgba(0,0,0,0.04)] px-4 py-2.5 flex items-center justify-between z-40">
        <span className="text-[12px] font-medium text-[#717171]">
          Unsaved changes may exist
        </span>
        <button
          onClick={() => { if (expandedProperty !== null) handleSave(expandedProperty); }}
          className="flex items-center gap-1.5 px-4 py-2 text-[12px] font-semibold text-white bg-[#007AFF] rounded-[8px] hover:bg-[#0066CC]">
          <Save className="w-3.5 h-3.5" />
          Save Settings
        </button>
      </div>
    </div>);

}
function SmoobuDetails({
  prop,
}: {prop: Property;}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen(!open)}
        className="text-[11px] font-medium text-[#007AFF] hover:underline flex items-center gap-1">

        {open ?
        <ChevronDown className="w-3 h-3" /> :

        <ChevronRight className="w-3 h-3" />
        }
        {open ? 'Hide details' : 'Show details'}
      </button>
      {open &&
      <div className="mt-2 space-y-3">
          {/* Beds */}
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <Bed className="w-3 h-3 text-[#717171]" />
              <span className="text-[10px] font-semibold uppercase tracking-[0.3px] text-[#717171]">
                Beds
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {prop.bedrooms != null &&
                <span className="text-[11px] bg-white px-2 py-0.5 rounded-full border border-[#EBEBEB] text-[#222222]">
                  {prop.bedrooms} Bedroom{prop.bedrooms !== 1 ? 's' : ''}
                </span>
              }
              {prop.bathrooms != null &&
                <span className="text-[11px] bg-white px-2 py-0.5 rounded-full border border-[#EBEBEB] text-[#222222]">
                  {prop.bathrooms} Bathroom{prop.bathrooms !== 1 ? 's' : ''}
                </span>
              }
              {prop.max_guests != null &&
                <span className="text-[11px] bg-white px-2 py-0.5 rounded-full border border-[#EBEBEB] text-[#222222]">
                  Max {prop.max_guests} Guest{prop.max_guests !== 1 ? 's' : ''}
                </span>
              }
            </div>
          </div>

          {/* Full Address */}
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <MapPin className="w-3 h-3 text-[#717171]" />
              <span className="text-[10px] font-semibold uppercase tracking-[0.3px] text-[#717171]">
                Full Address
              </span>
            </div>
            <div className="text-[11px] text-[#222222]">
              {prop.address || '—'}
            </div>
            {prop.location &&
            <div className="text-[10px] text-[#B0B0B0] mt-0.5">
              {prop.location}
            </div>
            }
          </div>

          {/* Neighbourhood */}
          {prop.neighbourhood &&
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <Globe className="w-3 h-3 text-[#717171]" />
              <span className="text-[10px] font-semibold uppercase tracking-[0.3px] text-[#717171]">
                Neighbourhood
              </span>
            </div>
            <div className="text-[11px] text-[#222222]">
              {prop.neighbourhood}
            </div>
          </div>
          }
        </div>
      }
    </div>);

}

function PropertySharing({ propertyId }: { propertyId: number }) {
  const [users, setUsers] = useState<{ user_id: number; role: string; name: string; email: string }[]>([]);
  const [allUsers, setAllUsers] = useState<{ id: number; name: string; email: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [addUserId, setAddUserId] = useState('');
  const [addRole, setAddRole] = useState('manager');

  const load = async () => {
    const [usersRes, allRes] = await Promise.all([
      fetch(`/api/properties/${propertyId}/users`, { credentials: 'same-origin' }),
      fetch('/api/users', { credentials: 'same-origin' }),
    ]);
    if (usersRes.ok) setUsers(await usersRes.json());
    if (allRes.ok) {
      const data = await allRes.json();
      setAllUsers(Array.isArray(data) ? data : data.users || []);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, [propertyId]);

  const handleAdd = async () => {
    if (!addUserId) return;
    await fetch(`/api/properties/${propertyId}/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ user_id: Number(addUserId), role: addRole }),
    });
    setAddUserId('');
    load();
  };

  const handleRemove = async (userId: number) => {
    await fetch(`/api/properties/${propertyId}/share/${userId}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    });
    load();
  };

  if (loading) return <div className="text-[12px] text-[#B0B0B0] py-2">Loading...</div>;

  const availableUsers = allUsers.filter((u) => !users.some((pu) => pu.user_id === u.id));

  return (
    <div className="space-y-3">
      {users.length === 0 && (
        <div className="text-[13px] text-[#B0B0B0]">No users assigned</div>
      )}
      {users.map((u) => (
        <div key={u.user_id} className="flex items-center justify-between">
          <div>
            <span className="text-[13px] font-medium text-[#222222]">{u.name || u.email}</span>
            <span className={`ml-2 text-[11px] font-semibold px-2 py-[2px] rounded-[4px] ${
              u.role === 'owner' ? 'bg-[#007AFF15] text-[#007AFF]' :
              u.role === 'manager' ? 'bg-[#00A69915] text-[#00A699]' :
              'bg-[#F7F7F7] text-[#717171]'
            }`}>
              {u.role}
            </span>
          </div>
          {u.role !== 'owner' && (
            <button
              onClick={() => handleRemove(u.user_id)}
              className="text-[#DC2626] p-1 rounded hover:bg-[#FEF2F2]">
              <X className="w-3.5 h-3.5" strokeWidth={2} />
            </button>
          )}
        </div>
      ))}

      {availableUsers.length > 0 && (
        <div className="flex items-center gap-2 pt-2 border-t border-[#F0F0F0]">
          <select
            value={addUserId}
            onChange={(e) => setAddUserId(e.target.value)}
            className="flex-1 text-[12px] px-2 py-1.5 border border-[#EBEBEB] rounded-[6px] bg-white focus:outline-none focus:border-[#007AFF]">
            <option value="">Add user...</option>
            {availableUsers.map((u) => (
              <option key={u.id} value={u.id}>{u.name || u.email}</option>
            ))}
          </select>
          <select
            value={addRole}
            onChange={(e) => setAddRole(e.target.value)}
            className="text-[12px] px-2 py-1.5 border border-[#EBEBEB] rounded-[6px] bg-white focus:outline-none focus:border-[#007AFF]">
            <option value="manager">Manager</option>
            <option value="viewer">Viewer</option>
          </select>
          <button
            onClick={handleAdd}
            disabled={!addUserId}
            className="p-1.5 bg-[#007AFF] text-white rounded-[6px] disabled:opacity-50">
            <Plus className="w-3.5 h-3.5" strokeWidth={2} />
          </button>
        </div>
      )}
    </div>
  );
}
