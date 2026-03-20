import { useState, useEffect } from 'react';
import { api } from '@/api/client';
import { useApi } from '@/hooks/useApi';
import type { Booking, DashboardStats, Property } from '@/types';
import PageHeader from '@/components/PageHeader';
import PlatformBadge from '@/components/PlatformBadge';
import { PageLoading, ErrorState, EmptyState } from '@/components/LoadingState';
import {
  RefreshCw, CalendarCheck, AlertTriangle, Users, TrendingUp,
  ChevronRight, Sparkles,
} from 'lucide-react';

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });
}

function isToday(d: string) {
  const t = new Date();
  const dt = new Date(d);
  return dt.toDateString() === t.toDateString();
}

function daysBetween(a: string, b: string) {
  return Math.ceil((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}

export default function DashboardPage() {
  const { data: properties } = useApi<Property[]>('/api/properties');
  const [propertyFilter, setPropertyFilter] = useState<string>('all');
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [bRes, sRes] = await Promise.all([
        api.get<{ bookings: Booking[]; display_currency: string }>('/api/bookings'),
        api.get<DashboardStats>('/api/dashboard/stats'),
      ]);
      setBookings(bRes.bookings);
      setStats(sRes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await api.post('/api/sync/properties');
      await api.post('/api/sync/bookings');
      await loadData();
    } catch { /* ignore */ } finally {
      setSyncing(false);
    }
  };

  if (loading) return <PageLoading />;
  if (error) return <ErrorState message={error} onRetry={loadData} />;
  if (!stats) return null;

  const today = new Date().toISOString().split('T')[0];

  const filteredBookings = propertyFilter === 'all'
    ? bookings
    : bookings.filter((b) => b.property_id === Number(propertyFilter));

  const currentStays = filteredBookings.filter(
    (b) => b.check_in <= today && b.check_out > today && b.platform?.toLowerCase() !== 'blocked'
  );
  const upcomingCheckIns = filteredBookings
    .filter((b) => b.check_in > today && b.platform?.toLowerCase() !== 'blocked')
    .sort((a, b) => a.check_in.localeCompare(b.check_in))
    .slice(0, 5);
  const upcomingCheckOuts = filteredBookings
    .filter((b) => b.check_out >= today && b.check_in < b.check_out && b.platform?.toLowerCase() !== 'blocked')
    .sort((a, b) => a.check_out.localeCompare(b.check_out))
    .slice(0, 5);

  const occupancy = propertyFilter === 'all'
    ? stats.occupancy
    : stats.occupancy.filter((o) => o.property_id === Number(propertyFilter));

  const gaps = propertyFilter === 'all'
    ? stats.gaps
    : stats.gaps.filter((g) => g.property_id === Number(propertyFilter));

  const jobs = propertyFilter === 'all'
    ? stats.pending_cleaning_jobs
    : stats.pending_cleaning_jobs.filter((j) => j.property_id === Number(propertyFilter));

  const avgOccupancy = occupancy.length > 0
    ? Math.round(occupancy.reduce((s, o) => s + o.occupancy_rate, 0) / occupancy.length)
    : 0;

  return (
    <>
      <PageHeader title="Dashboard">
        {properties && properties.length > 1 && (
          <select
            value={propertyFilter}
            onChange={(e) => setPropertyFilter(e.target.value)}
            className="input w-auto text-sm"
          >
            <option value="all">All properties</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        )}
        <button onClick={handleSync} disabled={syncing} className="btn-secondary text-sm flex items-center gap-1.5">
          <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
          Sync
        </button>
      </PageHeader>

      <div className="p-4 md:p-6 space-y-6">
        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiCard icon={CalendarCheck} label="Current stays" value={currentStays.length} color="blue" />
          <KpiCard icon={TrendingUp} label="Avg occupancy" value={`${avgOccupancy}%`} color="green" />
          <KpiCard icon={AlertTriangle} label="Gaps" value={gaps.length} color={gaps.length > 0 ? 'amber' : 'green'} />
          <KpiCard icon={Users} label="Cleaning jobs" value={jobs.length} color="purple" />
        </div>

        {/* Occupancy by property */}
        {occupancy.length > 0 && (
          <div className="card">
            <h2 className="text-base font-semibold text-gray-900 mb-4">Occupancy (30 days)</h2>
            <div className="space-y-3">
              {occupancy.map((o) => (
                <div key={o.property_id}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-700 font-medium">{o.name}</span>
                    <span className="text-gray-500">{Math.round(o.occupancy_rate)}% · {o.booked_nights} nights</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        o.occupancy_rate >= 75 ? 'bg-green-500' :
                        o.occupancy_rate >= 50 ? 'bg-amber-400' :
                        o.occupancy_rate >= 30 ? 'bg-yellow-400' : 'bg-red-400'
                      }`}
                      style={{ width: `${Math.min(100, o.occupancy_rate)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-6">
          {/* Current stays */}
          <div className="card">
            <h2 className="text-base font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <Sparkles size={16} className="text-primary-600" /> Currently staying
            </h2>
            {currentStays.length === 0 ? (
              <EmptyState message="No current stays" />
            ) : (
              <div className="space-y-3">
                {currentStays.map((b) => (
                  <div key={b.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{b.guest_name}</p>
                      <p className="text-xs text-gray-500">{b.property_name}</p>
                    </div>
                    <div className="text-right">
                      <PlatformBadge platform={b.platform} />
                      <p className="text-xs text-gray-500 mt-1">
                        out {formatDate(b.check_out)}
                        {isToday(b.check_out) && <span className="text-red-600 font-medium ml-1">today</span>}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Upcoming check-ins */}
          <div className="card">
            <h2 className="text-base font-semibold text-gray-900 mb-3">Upcoming check-ins</h2>
            {upcomingCheckIns.length === 0 ? (
              <EmptyState message="No upcoming check-ins" />
            ) : (
              <div className="space-y-2">
                {upcomingCheckIns.map((b) => (
                  <div key={b.id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{b.guest_name}</p>
                      <p className="text-xs text-gray-500">{b.property_name}</p>
                    </div>
                    <div className="text-right">
                      <PlatformBadge platform={b.platform} />
                      <p className="text-xs text-gray-500 mt-0.5">{formatDate(b.check_in)} · {b.length_of_stay || daysBetween(b.check_in, b.check_out)}n</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Gaps */}
        {gaps.length > 0 && (
          <div className="card border-l-4 border-l-amber-400">
            <h2 className="text-base font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <AlertTriangle size={16} className="text-amber-500" /> Booking gaps
            </h2>
            <div className="space-y-2">
              {gaps.map((g, i) => (
                <div key={i} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{g.property_name}</p>
                    <p className="text-xs text-gray-500">{formatDate(g.gap_start)} → {formatDate(g.gap_end)}</p>
                  </div>
                  <span className="text-sm font-semibold text-amber-600">{g.nights}n</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Cleaning jobs */}
        {jobs.length > 0 && (
          <div className="card">
            <h2 className="text-base font-semibold text-gray-900 mb-3">Pending cleaning jobs</h2>
            <div className="space-y-2">
              {jobs.map((j) => (
                <div key={j.id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${
                      j.status === 'completed' ? 'bg-green-500' :
                      j.status === 'confirmed' ? 'bg-blue-500' :
                      j.cleaner_name ? 'bg-yellow-400' : 'bg-red-400'
                    }`} />
                    <div>
                      <p className="text-sm font-medium text-gray-900">{j.property_name}</p>
                      <p className="text-xs text-gray-500">{j.cleaner_name || 'Unassigned'}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-gray-700">{formatDate(j.cleaning_date)}</p>
                    <p className="text-xs text-gray-500 capitalize">{j.status}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function KpiCard({ icon: Icon, label, value, color }: {
  icon: typeof CalendarCheck; label: string; value: string | number; color: string;
}) {
  const bg: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-green-50 text-green-600',
    amber: 'bg-amber-50 text-amber-600',
    purple: 'bg-purple-50 text-purple-600',
    red: 'bg-red-50 text-red-600',
  };
  return (
    <div className="card flex items-center gap-3">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${bg[color] || bg.blue}`}>
        <Icon size={20} />
      </div>
      <div>
        <p className="text-2xl font-bold text-gray-900">{value}</p>
        <p className="text-xs text-gray-500">{label}</p>
      </div>
    </div>
  );
}
