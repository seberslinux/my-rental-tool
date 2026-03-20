import { useState } from 'react';
import { api } from '@/api/client';
import { useApi } from '@/hooks/useApi';
import type { User, Property } from '@/types';
import PageHeader from '@/components/PageHeader';
import { PageLoading, ErrorState, EmptyState } from '@/components/LoadingState';
import { Plus, X, Shield, UserCog, Users as UsersIcon } from 'lucide-react';

const ROLE_BADGE: Record<string, string> = {
  admin: 'bg-purple-100 text-purple-700',
  property_manager: 'bg-blue-100 text-blue-700',
  cleaner: 'bg-green-100 text-green-700',
};

export default function UsersPage() {
  const { data: users, loading, error, refetch } = useApi<User[]>('/api/users');
  const { data: properties } = useApi<Property[]>('/api/properties');
  const [showForm, setShowForm] = useState(false);

  if (loading) return <PageLoading />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  return (
    <>
      <PageHeader title="Users">
        <button onClick={() => setShowForm(true)} className="btn-primary text-sm flex items-center gap-1.5">
          <Plus size={14} /> Add user
        </button>
      </PageHeader>

      <div className="p-4 md:p-6">
        {!users || users.length === 0 ? (
          <EmptyState message="No users" />
        ) : (
          <div className="card overflow-hidden p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left py-3 px-4 font-semibold text-gray-700">Name</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-700">Email</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-700">Role</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-700">Status</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        {u.avatar_url ? (
                          <img src={u.avatar_url} alt="" className="w-7 h-7 rounded-full" />
                        ) : (
                          <div className="w-7 h-7 bg-primary-100 text-primary-700 rounded-full flex items-center justify-center text-xs font-medium">
                            {u.name?.charAt(0) || '?'}
                          </div>
                        )}
                        <span className="font-medium text-gray-900">{u.name}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-gray-600">{u.email || '-'}</td>
                    <td className="py-3 px-4">
                      <span className={`badge ${ROLE_BADGE[u.role] || 'bg-gray-100 text-gray-600'}`}>
                        {u.role === 'property_manager' ? 'Manager' : u.role}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`inline-flex items-center gap-1 text-xs ${u.active !== false ? 'text-green-600' : 'text-gray-400'}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${u.active !== false ? 'bg-green-500' : 'bg-gray-300'}`} />
                        {u.active !== false ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showForm && (
        <UserFormModal
          properties={properties || []}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); refetch(); }}
        />
      )}
    </>
  );
}

function UserFormModal({ properties, onClose, onSaved }: {
  properties: Property[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: '',
    email: '',
    role: 'property_manager',
    password: '',
    property_ids: [] as number[],
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.post('/api/users', {
        name: form.name,
        email: form.email,
        role: form.role,
        password: form.password,
        property_ids: form.role === 'property_manager' ? form.property_ids : undefined,
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
          <h3 className="font-semibold text-gray-900">Add user</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-lg">{error}</div>}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input className="input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
            <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="admin">Admin</option>
              <option value="property_manager">Property Manager</option>
            </select>
          </div>
          {form.role === 'property_manager' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Properties</label>
              <div className="flex flex-wrap gap-2">
                {properties.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setForm((f) => ({
                      ...f,
                      property_ids: f.property_ids.includes(p.id)
                        ? f.property_ids.filter((id) => id !== p.id)
                        : [...f.property_ids, p.id],
                    }))}
                    className={`badge cursor-pointer ${
                      form.property_ids.includes(p.id) ? 'bg-primary-100 text-primary-700 border border-primary-300' : 'bg-gray-100 text-gray-600 border border-gray-200'
                    }`}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary flex-1">{saving ? 'Saving...' : 'Add user'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
