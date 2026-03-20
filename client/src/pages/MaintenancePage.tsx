import { useState, useEffect } from 'react';
import { api } from '@/api/client';
import type { MaintenanceIssue, Property } from '@/types';
import { useApi } from '@/hooks/useApi';
import PageHeader from '@/components/PageHeader';
import { PageLoading, ErrorState, EmptyState } from '@/components/LoadingState';
import { Plus, X, AlertCircle, Clock, CheckCircle2, Wrench } from 'lucide-react';

const PRIORITY_COLORS: Record<string, string> = {
  urgent: 'bg-red-100 text-red-700',
  high: 'bg-orange-100 text-orange-700',
  medium: 'bg-yellow-100 text-yellow-700',
  low: 'bg-gray-100 text-gray-600',
};

const STATUS_ICONS: Record<string, typeof AlertCircle> = {
  open: AlertCircle,
  in_progress: Clock,
  resolved: CheckCircle2,
};

export default function MaintenancePage() {
  const { data: properties } = useApi<Property[]>('/api/properties');
  const [issues, setIssues] = useState<MaintenanceIssue[]>([]);
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [showForm, setShowForm] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const params = statusFilter !== 'all' ? `?status=${statusFilter}` : '';
      const [issueRes, sumRes] = await Promise.all([
        api.get<MaintenanceIssue[]>(`/api/maintenance${params}`),
        api.get<Record<string, number>>('/api/maintenance/summary'),
      ]);
      setIssues(issueRes);
      setSummary(sumRes);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, [statusFilter]);

  const updateStatus = async (id: number, status: string) => {
    await api.put(`/api/maintenance/${id}`, { status });
    loadData();
  };

  if (loading) return <PageLoading />;

  return (
    <>
      <PageHeader title="Maintenance">
        <button onClick={() => setShowForm(true)} className="btn-primary text-sm flex items-center gap-1.5">
          <Plus size={14} /> Report issue
        </button>
      </PageHeader>

      <div className="p-4 md:p-6 space-y-6">
        {/* Summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <SummaryCard label="Open" value={summary.open || 0} color="text-red-600" />
          <SummaryCard label="In progress" value={summary.in_progress || 0} color="text-amber-600" />
          <SummaryCard label="Resolved" value={summary.resolved || 0} color="text-green-600" />
          <SummaryCard label="Urgent" value={summary.urgent_open || 0} color="text-red-600" />
        </div>

        {/* Filter */}
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
          {['all', 'open', 'in_progress', 'resolved'].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                statusFilter === s ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {s === 'all' ? 'All' : s === 'in_progress' ? 'In progress' : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>

        {issues.length === 0 ? (
          <EmptyState message="No maintenance issues" />
        ) : (
          <div className="space-y-3">
            {issues.map((issue) => {
              const StatusIcon = STATUS_ICONS[issue.status] || Wrench;
              return (
                <div key={issue.id} className="card">
                  <div className="flex items-start gap-3">
                    <StatusIcon size={18} className={`mt-0.5 ${
                      issue.status === 'open' ? 'text-red-500' :
                      issue.status === 'in_progress' ? 'text-amber-500' : 'text-green-500'
                    }`} />
                    <div className="flex-1">
                      <div className="flex items-start justify-between">
                        <div>
                          <h3 className="text-sm font-semibold text-gray-900">{issue.title}</h3>
                          <p className="text-xs text-gray-500">{issue.property_name} · {new Date(issue.reported_date).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })}</p>
                        </div>
                        <span className={`badge ${PRIORITY_COLORS[issue.priority] || PRIORITY_COLORS.low}`}>
                          {issue.priority}
                        </span>
                      </div>
                      {issue.description && <p className="text-sm text-gray-600 mt-2">{issue.description}</p>}
                      {issue.status !== 'resolved' && (
                        <div className="flex gap-2 mt-3">
                          {issue.status === 'open' && (
                            <button onClick={() => updateStatus(issue.id, 'in_progress')} className="btn-secondary text-xs">Start work</button>
                          )}
                          <button onClick={() => updateStatus(issue.id, 'resolved')} className="btn-secondary text-xs text-green-700">Resolve</button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showForm && (
        <IssueFormModal
          properties={properties || []}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); loadData(); }}
        />
      )}
    </>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="card">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
    </div>
  );
}

function IssueFormModal({ properties, onClose, onSaved }: {
  properties: Property[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    property_id: properties[0]?.id?.toString() || '',
    title: '',
    description: '',
    priority: 'medium',
    category: '',
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.post('/api/maintenance', {
        property_id: Number(form.property_id),
        title: form.title,
        description: form.description || undefined,
        priority: form.priority,
        category: form.category || undefined,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h3 className="font-semibold text-gray-900">Report issue</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-lg">{error}</div>}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Property</label>
            <select className="input" value={form.property_id} onChange={(e) => setForm({ ...form, property_id: e.target.value })}>
              {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
            <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea className="input" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
              <select className="input" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
              <input className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="e.g. Plumbing" />
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary flex-1">{saving ? 'Saving...' : 'Report'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
