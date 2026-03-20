import { useState } from 'react';
import { useApi } from '@/hooks/useApi';
import type { Property, Review } from '@/types';
import PageHeader from '@/components/PageHeader';
import { PageLoading, ErrorState, EmptyState } from '@/components/LoadingState';
import PlatformBadge from '@/components/PlatformBadge';
import { Star } from 'lucide-react';

export default function ReviewsPage() {
  const { data: properties } = useApi<Property[]>('/api/properties');
  const [propertyFilter, setPropertyFilter] = useState('all');

  const url = `/api/analytics/reviews${propertyFilter !== 'all' ? `?property_id=${propertyFilter}` : ''}`;
  const { data, loading, error, refetch } = useApi<{ reviews: Review[] } | Review[]>(url);

  if (loading) return <PageLoading />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const reviews: Review[] = Array.isArray(data) ? data : (data as { reviews: Review[] })?.reviews || [];
  const avgRating = reviews.length > 0 ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) : 0;

  return (
    <>
      <PageHeader title="Reviews">
        {properties && properties.length > 1 && (
          <select value={propertyFilter} onChange={(e) => setPropertyFilter(e.target.value)} className="input w-auto text-sm">
            <option value="all">All properties</option>
            {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
      </PageHeader>

      <div className="p-4 md:p-6 space-y-6">
        {/* Summary */}
        <div className="grid grid-cols-2 gap-4 max-w-sm">
          <div className="card">
            <p className="text-xs text-gray-500">Average rating</p>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-2xl font-bold text-gray-900">{avgRating.toFixed(1)}</span>
              <Star size={20} className="text-yellow-400 fill-yellow-400" />
            </div>
          </div>
          <div className="card">
            <p className="text-xs text-gray-500">Total reviews</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{reviews.length}</p>
          </div>
        </div>

        {/* Review list */}
        {reviews.length === 0 ? (
          <EmptyState message="No reviews yet" />
        ) : (
          <div className="space-y-3">
            {reviews.map((r) => (
              <div key={r.id} className="card">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 bg-gray-100 rounded-full flex items-center justify-center text-sm font-medium text-gray-600">
                      {r.guest_name?.charAt(0) || '?'}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">{r.guest_name || 'Anonymous'}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <p className="text-xs text-gray-500">{r.property_name}</p>
                        {r.platform && <PlatformBadge platform={r.platform} />}
                        <p className="text-xs text-gray-400">{new Date(r.date).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Star
                        key={i}
                        size={14}
                        className={i < r.rating ? 'text-yellow-400 fill-yellow-400' : 'text-gray-200'}
                      />
                    ))}
                  </div>
                </div>
                {r.comment && <p className="mt-3 text-sm text-gray-700 leading-relaxed">{r.comment}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
