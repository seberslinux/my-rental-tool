import { useState, useMemo } from 'react';
import { api } from '@/api/client';
import { useApi } from '@/hooks/useApi';
import type { Property } from '@/types';
import PageHeader from '@/components/PageHeader';
import { PageLoading, ErrorState, EmptyState } from '@/components/LoadingState';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';

const COLORS = ['#2563EB', '#EC4899', '#10B981', '#F59E0B', '#8B5CF6', '#14B8A6', '#EF4444'];

function getDefaultRange() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  return {
    from: `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}`,
    to: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
  };
}

export default function AnalyticsPage() {
  const { data: properties } = useApi<Property[]>('/api/properties');
  const [propertyFilter, setPropertyFilter] = useState('all');
  const [range, setRange] = useState(getDefaultRange);
  const [tab, setTab] = useState<'overview' | 'occupancy' | 'guests' | 'channels' | 'seasonality' | 'reviews'>('overview');

  const apiUrl = `/api/analytics/data?property_id=${propertyFilter}&from=${range.from}&to=${range.to}`;
  const { data, loading, error, refetch } = useApi<Record<string, unknown>>(apiUrl);

  if (loading) return <PageLoading />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const d = data as Record<string, unknown> || {};

  return (
    <>
      <PageHeader title="Analytics">
        {properties && properties.length > 1 && (
          <select value={propertyFilter} onChange={(e) => setPropertyFilter(e.target.value)} className="input w-auto text-sm">
            <option value="all">All properties</option>
            {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        <input type="month" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} className="input w-auto text-sm" />
        <input type="month" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} className="input w-auto text-sm" />
      </PageHeader>

      <div className="p-4 md:p-6 space-y-6">
        {/* Tabs */}
        <div className="flex gap-1 overflow-x-auto bg-gray-100 rounded-lg p-1">
          {(['overview', 'occupancy', 'guests', 'channels', 'seasonality', 'reviews'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap transition-colors ${
                tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {tab === 'overview' && <OverviewTab data={d} />}
        {tab === 'occupancy' && <OccupancyTab data={d} />}
        {tab === 'guests' && <GuestsTab data={d} />}
        {tab === 'channels' && <ChannelsTab data={d} />}
        {tab === 'seasonality' && <SeasonalityTab data={d} propertyFilter={propertyFilter} />}
        {tab === 'reviews' && <ReviewsTab data={d} propertyFilter={propertyFilter} />}
      </div>
    </>
  );
}

function KpiGrid({ items }: { items: { label: string; value: string | number }[] }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {items.map((item) => (
        <div key={item.label} className="card">
          <p className="text-xs text-gray-500">{item.label}</p>
          <p className="text-xl font-bold text-gray-900 mt-1">{item.value}</p>
        </div>
      ))}
    </div>
  );
}

function OverviewTab({ data }: { data: Record<string, unknown> }) {
  const kpis = data.kpis as Record<string, number> | undefined;
  const monthly = (data.monthly_revenue as { month: string; revenue: number }[]) || [];
  const propertyPerf = (data.property_performance as { name: string; revenue: number; occupancy: number }[]) || [];

  return (
    <div className="space-y-6">
      {kpis && (
        <KpiGrid items={[
          { label: 'Total revenue', value: `R${Math.round(kpis.total_revenue || 0).toLocaleString()}` },
          { label: 'Avg occupancy', value: `${Math.round(kpis.avg_occupancy || 0)}%` },
          { label: 'Avg nightly rate', value: `R${Math.round(kpis.avg_nightly_rate || 0).toLocaleString()}` },
          { label: 'Total bookings', value: kpis.total_bookings || 0 },
        ]} />
      )}

      {monthly.length > 0 && (
        <div className="card">
          <h3 className="text-base font-semibold text-gray-900 mb-4">Monthly revenue</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={monthly}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Bar dataKey="revenue" fill="#2563EB" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {propertyPerf.length > 0 && (
        <div className="card">
          <h3 className="text-base font-semibold text-gray-900 mb-4">Property performance</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 font-semibold text-gray-700">Property</th>
                  <th className="text-right py-2 font-semibold text-gray-700">Revenue</th>
                  <th className="text-right py-2 font-semibold text-gray-700">Occupancy</th>
                </tr>
              </thead>
              <tbody>
                {propertyPerf.map((p, i) => (
                  <tr key={i} className="border-b border-gray-50">
                    <td className="py-2 text-gray-900 font-medium">{p.name}</td>
                    <td className="py-2 text-right text-gray-700">R{Math.round(p.revenue).toLocaleString()}</td>
                    <td className="py-2 text-right text-gray-700">{Math.round(p.occupancy)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function OccupancyTab({ data }: { data: Record<string, unknown> }) {
  const monthly = (data.monthly_occupancy as { month: string; occupancy: number; adr: number; revpar: number }[]) || [];
  const leadTime = (data.lead_time_distribution as { bucket: string; count: number }[]) || [];
  const los = (data.los_distribution as { nights: number; count: number }[]) || [];

  return (
    <div className="space-y-6">
      {monthly.length > 0 && (
        <div className="card">
          <h3 className="text-base font-semibold text-gray-900 mb-4">Monthly occupancy & rates</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={monthly}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis yAxisId="left" tick={{ fontSize: 12 }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12 }} />
              <Tooltip />
              <Legend />
              <Line yAxisId="left" type="monotone" dataKey="occupancy" stroke="#2563EB" name="Occupancy %" strokeWidth={2} />
              <Line yAxisId="right" type="monotone" dataKey="adr" stroke="#10B981" name="ADR" strokeWidth={2} />
              <Line yAxisId="right" type="monotone" dataKey="revpar" stroke="#8B5CF6" name="RevPAR" strokeWidth={2} strokeDasharray="5 5" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        {leadTime.length > 0 && (
          <div className="card">
            <h3 className="text-base font-semibold text-gray-900 mb-4">Lead time distribution</h3>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={leadTime} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis type="number" tick={{ fontSize: 12 }} />
                <YAxis dataKey="bucket" type="category" tick={{ fontSize: 12 }} width={80} />
                <Tooltip />
                <Bar dataKey="count" fill="#2563EB" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {los.length > 0 && (
          <div className="card">
            <h3 className="text-base font-semibold text-gray-900 mb-4">Length of stay</h3>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={los}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="nights" tick={{ fontSize: 12 }} label={{ value: 'Nights', position: 'bottom', fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="count" fill="#8B5CF6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}

function GuestsTab({ data }: { data: Record<string, unknown> }) {
  const countries = (data.guest_countries as { country: string; count: number }[]) || [];
  const languages = (data.guest_languages as { language: string; count: number }[]) || [];

  return (
    <div className="space-y-6">
      {countries.length > 0 && (
        <div className="card">
          <h3 className="text-base font-semibold text-gray-900 mb-4">Guest countries</h3>
          <ResponsiveContainer width="100%" height={Math.max(200, countries.length * 35)}>
            <BarChart data={countries.slice(0, 10)} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis type="number" tick={{ fontSize: 12 }} />
              <YAxis dataKey="country" type="category" tick={{ fontSize: 12 }} width={100} />
              <Tooltip />
              <Bar dataKey="count" fill="#2563EB" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {languages.length > 0 && (
        <div className="card">
          <h3 className="text-base font-semibold text-gray-900 mb-4">Guest languages</h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie data={languages.slice(0, 7)} cx="50%" cy="50%" outerRadius={100} dataKey="count" nameKey="language" label>
                {languages.slice(0, 7).map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}

      {countries.length === 0 && languages.length === 0 && (
        <EmptyState message="No guest data available for this period" />
      )}
    </div>
  );
}

function ChannelsTab({ data }: { data: Record<string, unknown> }) {
  const channels = (data.channel_mix as { channel: string; bookings: number; revenue: number }[]) || [];

  const CHANNEL_COLORS: Record<string, string> = {
    airbnb: '#EC4899',
    'booking.com': '#1E3A8A',
    booking: '#1E3A8A',
    direct: '#10B981',
    vrbo: '#F59E0B',
  };

  return (
    <div className="space-y-6">
      {channels.length > 0 ? (
        <>
          <div className="grid md:grid-cols-2 gap-6">
            <div className="card">
              <h3 className="text-base font-semibold text-gray-900 mb-4">Booking mix</h3>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie data={channels} cx="50%" cy="50%" outerRadius={100} dataKey="bookings" nameKey="channel" label>
                    {channels.map((c, i) => (
                      <Cell key={i} fill={CHANNEL_COLORS[c.channel?.toLowerCase()] || COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div className="card">
              <h3 className="text-base font-semibold text-gray-900 mb-4">Revenue by channel</h3>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={channels}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="channel" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="revenue" radius={[4, 4, 0, 0]}>
                    {channels.map((c, i) => (
                      <Cell key={i} fill={CHANNEL_COLORS[c.channel?.toLowerCase()] || COLORS[i % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="card">
            <h3 className="text-base font-semibold text-gray-900 mb-4">Channel performance</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 font-semibold text-gray-700">Channel</th>
                  <th className="text-right py-2 font-semibold text-gray-700">Bookings</th>
                  <th className="text-right py-2 font-semibold text-gray-700">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {channels.map((c, i) => (
                  <tr key={i} className="border-b border-gray-50">
                    <td className="py-2 text-gray-900 font-medium capitalize">{c.channel}</td>
                    <td className="py-2 text-right text-gray-700">{c.bookings}</td>
                    <td className="py-2 text-right text-gray-700">R{Math.round(c.revenue).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <EmptyState message="No channel data available for this period" />
      )}
    </div>
  );
}

function SeasonalityTab({ data, propertyFilter }: { data: Record<string, unknown>; propertyFilter: string }) {
  const seasonality = (data.seasonality as { month: number; occupancy: number }[]) || [];
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  const formatted = seasonality.map((s) => ({
    month: monthNames[(s.month - 1) % 12] || `M${s.month}`,
    occupancy: Math.round(s.occupancy),
  }));

  return (
    <div className="space-y-6">
      {formatted.length > 0 ? (
        <div className="card">
          <h3 className="text-base font-semibold text-gray-900 mb-4">Occupancy by month</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={formatted}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} domain={[0, 100]} />
              <Tooltip />
              <Bar dataKey="occupancy" fill="#2563EB" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <EmptyState message="No seasonality data available" />
      )}
    </div>
  );
}

function ReviewsTab({ data, propertyFilter }: { data: Record<string, unknown>; propertyFilter: string }) {
  const reviews = (data.reviews as { id: number; guest_name: string; rating: number; comment: string; date: string; platform: string }[]) || [];
  const avgRating = reviews.length > 0 ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1) : '0';

  return (
    <div className="space-y-6">
      <KpiGrid items={[
        { label: 'Avg rating', value: avgRating },
        { label: 'Total reviews', value: reviews.length },
      ]} />

      {reviews.length > 0 ? (
        <div className="space-y-3">
          {reviews.slice(0, 20).map((r) => (
            <div key={r.id} className="card">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900">{r.guest_name || 'Anonymous'}</p>
                  <p className="text-xs text-gray-500">{new Date(r.date).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-sm font-bold text-gray-900">{r.rating}</span>
                  <span className="text-yellow-400">★</span>
                </div>
              </div>
              {r.comment && <p className="mt-2 text-sm text-gray-700">{r.comment}</p>}
            </div>
          ))}
        </div>
      ) : (
        <EmptyState message="No reviews available" />
      )}
    </div>
  );
}
