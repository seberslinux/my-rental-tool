import { useState, useEffect } from 'react';
import { api } from '@/api/client';
import { useApi } from '@/hooks/useApi';
import type { Property, Expense, ExpenseCategory } from '@/types';
import PageHeader from '@/components/PageHeader';
import { PageLoading, ErrorState, EmptyState } from '@/components/LoadingState';
import { Plus, X, DollarSign, TrendingUp, TrendingDown } from 'lucide-react';

function getMonthRange() {
  const now = new Date();
  const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const to = `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`;
  return { from, to };
}

export default function FinancesPage() {
  const { data: properties } = useApi<Property[]>('/api/properties');
  const { data: categories } = useApi<ExpenseCategory[]>('/api/finances/categories');
  const [propertyFilter, setPropertyFilter] = useState<string>('all');
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [pnl, setPnl] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const { from, to } = getMonthRange();
      const propParam = propertyFilter === 'all' ? '' : `&property_id=${propertyFilter}`;
      const [expRes, pnlRes] = await Promise.all([
        api.get<Expense[]>(`/api/finances/expenses?from=${from}&to=${to}${propParam}`),
        api.get<Record<string, unknown>>(`/api/finances/pnl?from=${from}&to=${to}${propParam.replace('&', '?')}`),
      ]);
      setExpenses(Array.isArray(expRes) ? expRes : []);
      setPnl(pnlRes);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, [propertyFilter]);

  if (loading) return <PageLoading />;

  const totalExpenses = expenses.reduce((s, e) => s + (e.amount || 0), 0);
  const revenue = (pnl as Record<string, number>)?.total_revenue || 0;
  const profit = revenue - totalExpenses;

  return (
    <>
      <PageHeader title="Finances">
        {properties && properties.length > 1 && (
          <select value={propertyFilter} onChange={(e) => setPropertyFilter(e.target.value)} className="input w-auto text-sm">
            <option value="all">All properties</option>
            {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        <button onClick={() => setShowForm(true)} className="btn-primary text-sm flex items-center gap-1.5">
          <Plus size={14} /> Add expense
        </button>
      </PageHeader>

      <div className="p-4 md:p-6 space-y-6">
        <div className="grid grid-cols-3 gap-4">
          <div className="card">
            <div className="flex items-center gap-2 text-green-600 mb-1"><TrendingUp size={16} /><span className="text-xs text-gray-500">Revenue</span></div>
            <p className="text-xl font-bold text-gray-900">R{Math.round(revenue).toLocaleString()}</p>
          </div>
          <div className="card">
            <div className="flex items-center gap-2 text-red-500 mb-1"><TrendingDown size={16} /><span className="text-xs text-gray-500">Expenses</span></div>
            <p className="text-xl font-bold text-gray-900">R{Math.round(totalExpenses).toLocaleString()}</p>
          </div>
          <div className="card">
            <div className="flex items-center gap-2 mb-1"><DollarSign size={16} className={profit >= 0 ? 'text-green-600' : 'text-red-500'} /><span className="text-xs text-gray-500">Profit</span></div>
            <p className={`text-xl font-bold ${profit >= 0 ? 'text-green-700' : 'text-red-600'}`}>R{Math.round(profit).toLocaleString()}</p>
          </div>
        </div>

        <div className="card">
          <h3 className="text-base font-semibold text-gray-900 mb-3">Expenses this month</h3>
          {expenses.length === 0 ? (
            <EmptyState message="No expenses recorded" />
          ) : (
            <div className="space-y-2">
              {expenses.map((e) => (
                <div key={e.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{e.description}</p>
                    <p className="text-xs text-gray-500">{e.category_name} · {e.property_name || 'General'} · {new Date(e.date).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })}</p>
                  </div>
                  <span className="text-sm font-semibold text-gray-900">R{e.amount.toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showForm && (
        <ExpenseFormModal
          properties={properties || []}
          categories={categories || []}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); loadData(); }}
        />
      )}
    </>
  );
}

function ExpenseFormModal({ properties, categories, onClose, onSaved }: {
  properties: Property[];
  categories: ExpenseCategory[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    property_id: properties[0]?.id?.toString() || '',
    category_id: categories[0]?.id?.toString() || '',
    description: '',
    amount: '',
    date: new Date().toISOString().split('T')[0],
    vendor: '',
    currency: 'ZAR',
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.post('/api/finances/expenses', {
        property_id: Number(form.property_id),
        category_id: Number(form.category_id),
        description: form.description,
        amount: Number(form.amount),
        date: form.date,
        vendor: form.vendor || undefined,
        currency: form.currency,
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
          <h3 className="font-semibold text-gray-900">Add expense</h3>
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
            <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
            <select className="input" value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Amount (R)</label>
              <input className="input" type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
              <input className="input" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Vendor</label>
            <input className="input" value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary flex-1">{saving ? 'Saving...' : 'Add expense'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
