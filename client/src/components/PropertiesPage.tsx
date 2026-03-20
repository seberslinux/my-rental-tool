import React, { useState } from 'react';
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
  Globe } from
'lucide-react';
interface SmoobuData {
  location: {
    street: string;
    zip: string;
    city: string;
    country: string;
    lat: string;
    lng: string;
  };
  rooms: {
    maxOccupancy: number;
    bedrooms: number;
    bathrooms: number;
    doubleBeds: number;
    singleBeds: number;
    sofaBeds: number;
    couches: number;
    childBeds: number;
    queenSizeBeds: number;
    kingSizeBeds: number;
  };
  timeZone: string;
  equipments: string[];
  currency: string;
  price: {
    minimal: number;
    maximal: number;
  };
  type: {
    id: number;
    name: string;
  };
}
const smoobuDataMap: Record<number, SmoobuData> = {
  1: {
    location: {
      street: '12 Ocean View Dr',
      zip: '8005',
      city: 'Cape Town',
      country: 'South Africa',
      lat: '-33.9249',
      lng: '18.4241'
    },
    rooms: {
      maxOccupancy: 6,
      bedrooms: 3,
      bathrooms: 2,
      doubleBeds: 1,
      singleBeds: 0,
      sofaBeds: 1,
      couches: 1,
      childBeds: 0,
      queenSizeBeds: 1,
      kingSizeBeds: 1
    },
    timeZone: 'Africa/Johannesburg',
    equipments: [
    'WiFi',
    'Pool',
    'Air conditioning',
    'Kitchen',
    'Parking',
    'Washer',
    'TV',
    'Ocean view',
    'BBQ'],

    currency: 'ZAR',
    price: {
      minimal: 1800,
      maximal: 3200
    },
    type: {
      id: 3,
      name: 'Villa'
    }
  },
  2: {
    location: {
      street: '45 Main Rd',
      zip: '8051',
      city: 'Cape Town',
      country: 'South Africa',
      lat: '-33.9062',
      lng: '18.4232'
    },
    rooms: {
      maxOccupancy: 2,
      bedrooms: 1,
      bathrooms: 1,
      doubleBeds: 1,
      singleBeds: 0,
      sofaBeds: 0,
      couches: 1,
      childBeds: 0,
      queenSizeBeds: 0,
      kingSizeBeds: 0
    },
    timeZone: 'Africa/Johannesburg',
    equipments: ['WiFi', 'Air conditioning', 'Kitchen', 'Washer', 'TV'],
    currency: 'ZAR',
    price: {
      minimal: 1200,
      maximal: 1800
    },
    type: {
      id: 1,
      name: 'Apartment'
    }
  }
};
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
  const [expandedProperty, setExpandedProperty] = useState<number | null>(1);
  const properties = [
  {
    id: 1,
    name: 'Hill Top Lodge',
    smoobuId: '2500823'
  },
  {
    id: 2,
    name: 'The loft',
    smoobuId: '2297844'
  }];

  const toggleProperty = (id: number) => {
    setExpandedProperty(expandedProperty === id ? null : id);
  };
  const bedSummary = (r: SmoobuData['rooms']) => {
    const parts: string[] = [];
    if (r.kingSizeBeds > 0) parts.push(`${r.kingSizeBeds} King`);
    if (r.queenSizeBeds > 0) parts.push(`${r.queenSizeBeds} Queen`);
    if (r.doubleBeds > 0) parts.push(`${r.doubleBeds} Double`);
    if (r.singleBeds > 0) parts.push(`${r.singleBeds} Single`);
    if (r.sofaBeds > 0) parts.push(`${r.sofaBeds} Sofa`);
    if (r.couches > 0) parts.push(`${r.couches} Couch`);
    if (r.childBeds > 0) parts.push(`${r.childBeds} Child`);
    return parts.join(' · ');
  };
  return (
    <div className="p-4 md:p-6 max-w-[1200px] mx-auto space-y-3 md:space-y-4 pb-28">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white rounded-[10px] p-3 md:p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] border border-[#EBEBEB]">
        <div>
          <p className="text-[12px] md:text-[13px] text-[#717171]">
            Sync properties from Smoobu first, then configure settings below.
          </p>
          <p className="text-[10px] text-[#B0B0B0] mt-0.5">
            Last synced: 19 Mar 2026, 08:14
          </p>
        </div>
        <button className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-[12px] md:text-[13px] font-semibold text-[#007AFF] bg-[#F0F9FF] border border-[#007AFF30] rounded-[8px] hover:bg-[#E0F2FE] transition-colors whitespace-nowrap">
          <RefreshCw className="w-3.5 h-3.5" />
          Sync from Smoobu
        </button>
      </div>

      {/* Property Cards */}
      <div className="space-y-3">
        {properties.map((prop) => {
          const isExpanded = expandedProperty === prop.id;
          const smoobu = smoobuDataMap[prop.id];
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
                      {smoobu &&
                      <span className="text-[11px] text-[#717171] bg-[#F7F7F7] px-1.5 py-0.5 rounded">
                          {smoobu.type.name}
                        </span>
                      }
                    </div>
                    <p className="text-[11px] text-[#B0B0B0]">
                      ID: {prop.smoobuId}
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
                    onClick={(e) => e.stopPropagation()}>
                    
                    <Save className="w-3.5 h-3.5" />
                    Save
                  </button>
                </div>
              </div>

              {/* Expanded Content */}
              {isExpanded && smoobu &&
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
                        {smoobu.rooms.bedrooms}
                      </span>
                      <span>
                        <span className="text-[#B0B0B0]">Baths:</span>{' '}
                        {smoobu.rooms.bathrooms}
                      </span>
                      <span>
                        <span className="text-[#B0B0B0]">Guests:</span>{' '}
                        {smoobu.rooms.maxOccupancy}
                      </span>
                      <span>
                        <span className="text-[#B0B0B0]">Price:</span> R{' '}
                        {smoobu.price.minimal.toLocaleString()}–
                        {smoobu.price.maximal.toLocaleString()}
                      </span>
                      <span>
                        <span className="text-[#B0B0B0]">Currency:</span>{' '}
                        {smoobu.currency}
                      </span>
                    </div>
                    <div className="text-[11px] text-[#717171] flex items-center gap-1">
                      <MapPin className="w-3 h-3" />
                      {smoobu.location.street}, {smoobu.location.city},{' '}
                      {smoobu.location.country}
                    </div>

                    {/* Expandable details */}
                    <SmoobuDetails smoobu={smoobu} bedSummary={bedSummary} />
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
                        defaultValue={2.5}
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
                        {[
                      {
                        label: 'Airbnb',
                        urlPh: 'https://www.airbnb.com/rooms/...',
                        idPh: 'e.g. 12345678'
                      },
                      {
                        label: 'Booking.com',
                        urlPh: 'https://www.booking.com/hotel/...',
                        idPh: 'e.g. 987654'
                      },
                      {
                        label: 'VRBO',
                        urlPh: 'https://www.vrbo.com/...',
                        idPh: 'e.g. 1122334'
                      }].
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
                            className={inputCls} />
                          
                            </div>
                            <div>
                              <label className="block text-[11px] font-medium text-[#222222] mb-1">
                                {p.label} ID
                              </label>
                              <input
                            type="text"
                            placeholder={p.idPh}
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
                        {[
                      {
                        l: 'Airbnb %',
                        v: 18
                      },
                      {
                        l: 'Booking.com %',
                        v: 15
                      },
                      {
                        l: 'VRBO %',
                        v: 8
                      }].
                      map((c) =>
                      <div key={c.l}>
                            <label className="block text-[11px] font-medium text-[#222222] mb-1">
                              {c.l}
                            </label>
                            <input
                          type="number"
                          defaultValue={c.v}
                          className={inputCls} />
                        
                          </div>
                      )}
                      </div>

                      <div className="text-[11px] font-semibold text-[#717171] uppercase tracking-[0.3px] mb-2">
                        Bank Charges
                      </div>
                      <div className="grid grid-cols-3 gap-2 mb-3">
                        {[
                      {
                        l: 'Airbnb %',
                        v: 0
                      },
                      {
                        l: 'Booking.com %',
                        v: 2.1
                      },
                      {
                        l: 'VRBO %',
                        v: 0
                      }].
                      map((c) =>
                      <div key={c.l + 'bank'}>
                            <label className="block text-[11px] font-medium text-[#222222] mb-1">
                              {c.l}
                            </label>
                            <input
                          type="number"
                          defaultValue={c.v}
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
                        defaultValue={0}
                        className={inputCls} />
                      
                        <p className="text-[10px] text-[#B0B0B0] mt-1 leading-tight">
                          Set to 14 if Booking.com rates include VAT.
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
                          className={inputCls} />
                        
                        </div>
                        <div>
                          <label className="block text-[11px] font-medium text-[#222222] mb-1">
                            Check-out Time
                          </label>
                          <input
                          type="text"
                          placeholder="e.g. 10:00"
                          className={inputCls} />
                        
                        </div>
                        <div>
                          <label className="block text-[11px] font-medium text-[#222222] mb-1">
                            WiFi Name
                          </label>
                          <input
                          type="text"
                          placeholder="Network name"
                          className={inputCls} />
                        
                        </div>
                        <div>
                          <label className="block text-[11px] font-medium text-[#222222] mb-1">
                            WiFi Password
                          </label>
                          <input
                          type="text"
                          placeholder="Password"
                          className={inputCls} />
                        
                        </div>
                      </div>
                      <div className="mt-3">
                        <label className="block text-[11px] font-medium text-[#222222] mb-1">
                          House Rules / Notes
                        </label>
                        <textarea
                        placeholder="e.g. No smoking, quiet hours after 22:00..."
                        className="w-full h-16 p-2 border border-[#EBEBEB] rounded-[8px] text-[13px] focus:outline-none focus:border-[#007AFF] focus:ring-1 focus:ring-[#007AFF] resize-none" />
                      
                      </div>
                    </Section>
                  </div>

                  {/* Save Button */}
                  <div className="flex justify-end pt-3">
                    <button className="flex items-center gap-1.5 px-4 py-2 text-[12px] md:text-[13px] font-semibold text-white bg-[#007AFF] rounded-[8px] hover:bg-[#0066CC]">
                      <Save className="w-3.5 h-3.5" />
                      Save Settings
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
        <button className="flex items-center gap-1.5 px-4 py-2 text-[12px] font-semibold text-white bg-[#007AFF] rounded-[8px] hover:bg-[#0066CC]">
          <Save className="w-3.5 h-3.5" />
          Save Settings
        </button>
      </div>
    </div>);

}
function SmoobuDetails({
  smoobu,
  bedSummary



}: {smoobu: SmoobuData;bedSummary: (r: SmoobuData['rooms']) => string;}) {
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
              {bedSummary(smoobu.rooms).
            split(' · ').
            map((b) =>
            <span
              key={b}
              className="text-[11px] bg-white px-2 py-0.5 rounded-full border border-[#EBEBEB] text-[#222222]">
              
                    {b}
                  </span>
            )}
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
              {smoobu.location.street}, {smoobu.location.zip}{' '}
              {smoobu.location.city}, {smoobu.location.country}
            </div>
            <div className="text-[10px] text-[#B0B0B0] mt-0.5">
              {smoobu.location.lat}, {smoobu.location.lng}
            </div>
          </div>

          {/* Amenities */}
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <Wifi className="w-3 h-3 text-[#717171]" />
              <span className="text-[10px] font-semibold uppercase tracking-[0.3px] text-[#717171]">
                Amenities
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {smoobu.equipments.map((eq) =>
            <span
              key={eq}
              className="text-[11px] bg-[#F0F9FF] text-[#007AFF] px-2 py-0.5 rounded-full">
              
                  {eq}
                </span>
            )}
            </div>
          </div>

          {/* Timezone */}
          <div className="flex items-center gap-1.5">
            <Globe className="w-3 h-3 text-[#717171]" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.3px] text-[#717171]">
              Timezone
            </span>
            <span className="text-[11px] text-[#222222] ml-1">
              {smoobu.timeZone}
            </span>
          </div>
        </div>
      }
    </div>);

}