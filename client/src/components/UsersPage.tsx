import React, { useState, useEffect, useCallback } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Save,
  X,
  Shield,
  Mail,
  Key,
  Home,
  UserCheck,
  UserX } from
'lucide-react';

interface User {
  id: number;
  email: string;
  name: string;
  role: 'admin' | 'property_manager' | 'cleaner';
  avatar_url: string | null;
  active: boolean;
  created_at: string;
  property_ids: number[];
}

interface Property {
  id: number;
  name: string;
}

interface UserForm {
  name: string;
  role: string;
  password: string;
  property_ids: number[];
}

function buildForm(u: User): UserForm {
  return {
    name: u.name || '',
    role: u.role,
    password: '',
    property_ids: u.property_ids || [],
  };
}

const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  property_manager: 'Property Manager',
  cleaner: 'Cleaner',
};

const ROLE_COLORS: Record<string, string> = {
  admin: 'bg-[#8B5CF6]/10 text-[#7C3AED]',
  property_manager: 'bg-[#007AFF]/10 text-[#007AFF]',
  cleaner: 'bg-[#00A699]/10 text-[#00A699]',
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

const inputCls =
'w-full h-9 px-3 border border-[#EBEBEB] rounded-[8px] text-[13px] focus:outline-none focus:border-[#007AFF] focus:ring-1 focus:ring-[#007AFF]';

export function UsersPage() {
  const [expandedUser, setExpandedUser] = useState<number | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [forms, setForms] = useState<Record<number, UserForm>>({});
  const [savingId, setSavingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);

  // New user form
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState('property_manager');
  const [newPassword, setNewPassword] = useState('');
  const [newPropertyIds, setNewPropertyIds] = useState<number[]>([]);
  const [addError, setAddError] = useState('');
  const [adding, setAdding] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [usersRes, propsRes] = await Promise.all([
        fetch('/api/users', { credentials: 'same-origin' }),
        fetch('/api/properties', { credentials: 'same-origin' }),
      ]);
      if (usersRes.ok) {
        const data: User[] = await usersRes.json();
        setUsers(data);
        const newForms: Record<number, UserForm> = {};
        data.forEach((u) => { newForms[u.id] = buildForm(u); });
        setForms(newForms);
      }
      if (propsRes.ok) {
        const data = await propsRes.json();
        setProperties(data);
      }
    } catch (err) {
      console.error('Error fetching users:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const updateForm = (userId: number, key: keyof UserForm, value: any) => {
    setForms((prev) => ({
      ...prev,
      [userId]: { ...prev[userId], [key]: value },
    }));
  };

  const toggleProperty = (userId: number, propId: number) => {
    const current = forms[userId]?.property_ids || [];
    const next = current.includes(propId)
      ? current.filter((id) => id !== propId)
      : [...current, propId];
    updateForm(userId, 'property_ids', next);
  };

  const handleSave = async (userId: number) => {
    const form = forms[userId];
    if (!form) return;
    setSavingId(userId);
    try {
      const body: any = {
        name: form.name,
        role: form.role,
        property_ids: form.role === 'property_manager' ? form.property_ids : undefined,
      };
      if (form.password) body.password = form.password;
      const res = await fetch(`/api/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Save failed');
      } else {
        // Clear password field after save
        updateForm(userId, 'password', '');
        await fetchData();
      }
    } catch (err) {
      console.error('Error saving user:', err);
    } finally {
      setSavingId(null);
    }
  };

  const handleDeactivate = async (userId: number) => {
    if (!confirm('Deactivate this user?')) return;
    try {
      await fetch(`/api/users/${userId}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      await fetchData();
    } catch (err) {
      console.error('Error deactivating user:', err);
    }
  };

  const handleAdd = async () => {
    setAddError('');
    if (!newName || !newEmail || !newPassword) {
      setAddError('Name, email, and password are required');
      return;
    }
    setAdding(true);
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          name: newName,
          email: newEmail,
          role: newRole,
          password: newPassword,
          property_ids: newRole === 'property_manager' ? newPropertyIds : undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to create user');
      }
      setShowAddForm(false);
      setNewName(''); setNewEmail(''); setNewRole('property_manager'); setNewPassword(''); setNewPropertyIds([]);
      await fetchData();
    } catch (err: any) {
      setAddError(err.message || 'Failed to create user');
    } finally {
      setAdding(false);
    }
  };

  const toggleProperty_id = (id: number) => {
    setExpandedUser(expandedUser === id ? null : id);
  };

  if (loading) {
    return (
      <div className="p-4 md:p-6 flex justify-center pt-20">
        <div className="w-8 h-8 border-2 border-[#007AFF] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-[1200px] mx-auto space-y-3 md:space-y-4 pb-28">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white rounded-[10px] p-3 md:p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] border border-[#EBEBEB]">
        <div>
          <p className="text-[12px] md:text-[13px] text-[#717171]">
            Manage team members and their access to properties.
          </p>
          <p className="text-[10px] text-[#B0B0B0] mt-0.5">
            {users.length} user{users.length !== 1 ? 's' : ''} · {users.filter(u => u.active !== false).length} active
          </p>
        </div>
        <button
          onClick={() => setShowAddForm(true)}
          className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-[12px] md:text-[13px] font-semibold text-white bg-[#007AFF] rounded-[8px] hover:bg-[#0066CC] transition-colors whitespace-nowrap">
          <Plus className="w-3.5 h-3.5" />
          Add User
        </button>
      </div>

      {/* User Cards */}
      <div className="space-y-3">
        {users.map((user) => {
          const isExpanded = expandedUser === user.id;
          const form = forms[user.id];
          const isInactive = user.active === false;
          return (
            <div
              key={user.id}
              className={`bg-white rounded-[10px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] border border-[#EBEBEB] overflow-hidden ${isInactive ? 'opacity-60' : ''}`}>

              {/* Card Header */}
              <div
                className={`p-3 md:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 cursor-pointer hover:bg-[#FAFAFA] transition-colors ${isExpanded ? 'border-b border-[#EBEBEB]' : ''}`}
                onClick={() => toggleProperty_id(user.id)}>

                <div className="flex items-center gap-2.5">
                  <div className="text-[#B0B0B0]">
                    {isExpanded ?
                    <ChevronDown className="w-4 h-4" /> :
                    <ChevronRight className="w-4 h-4" />
                    }
                  </div>
                  <div className="flex items-center gap-3">
                    {user.avatar_url ?
                      <img src={user.avatar_url} alt="" className="w-9 h-9 rounded-full" /> :
                      <div className="w-9 h-9 rounded-full bg-[#007AFF] flex items-center justify-center text-white font-semibold text-[14px]">
                        {(user.name || '?').charAt(0).toUpperCase()}
                      </div>
                    }
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-[15px] md:text-[16px] font-bold text-[#222222]">
                          {user.name}
                        </h2>
                        <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded ${ROLE_COLORS[user.role] || 'bg-[#F7F7F7] text-[#717171]'}`}>
                          {ROLE_LABELS[user.role] || user.role}
                        </span>
                        {isInactive &&
                          <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-[#FEF2F2] text-[#DC2626]">
                            Inactive
                          </span>
                        }
                      </div>
                      <p className="text-[11px] text-[#B0B0B0]">
                        {user.email}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 pl-7 sm:pl-0">
                  <button
                    className="flex items-center gap-1 px-3 py-1.5 text-[12px] font-semibold text-white bg-[#007AFF] rounded-[6px] hover:bg-[#0066CC]"
                    onClick={(e) => { e.stopPropagation(); handleSave(user.id); }}>
                    <Save className="w-3.5 h-3.5" />
                    {savingId === user.id ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </div>

              {/* Expanded Content */}
              {isExpanded && form &&
              <div className="p-3 md:p-4">
                {/* User Summary */}
                <div className="bg-[#F7F7F7] rounded-[8px] p-3 mb-3">
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-[#222222]">
                    <span>
                      <span className="text-[#B0B0B0]">Role:</span>{' '}
                      {ROLE_LABELS[user.role]}
                    </span>
                    <span>
                      <span className="text-[#B0B0B0]">Status:</span>{' '}
                      {user.active !== false ? 'Active' : 'Inactive'}
                    </span>
                    <span>
                      <span className="text-[#B0B0B0]">Joined:</span>{' '}
                      {user.created_at ? new Date(user.created_at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                    </span>
                    {user.role === 'property_manager' &&
                      <span>
                        <span className="text-[#B0B0B0]">Properties:</span>{' '}
                        {user.property_ids?.length || 0}
                      </span>
                    }
                  </div>
                </div>

                {/* Editable Settings */}
                <div>
                  <Section icon={Shield} title="Role & Name" defaultOpen={true}>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-medium text-[#222222] mb-1">
                          Name
                        </label>
                        <input
                          type="text"
                          value={form.name}
                          onChange={(e) => updateForm(user.id, 'name', e.target.value)}
                          className={inputCls} />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-[#222222] mb-1">
                          Role
                        </label>
                        <select
                          value={form.role}
                          onChange={(e) => updateForm(user.id, 'role', e.target.value)}
                          className={`${inputCls} bg-white`}>
                          <option value="admin">Admin</option>
                          <option value="property_manager">Property Manager</option>
                          <option value="cleaner">Cleaner</option>
                        </select>
                      </div>
                    </div>
                  </Section>

                  <Section icon={Key} title="Password">
                    <div className="w-full sm:w-64">
                      <label className="block text-[11px] font-medium text-[#222222] mb-1">
                        New Password
                      </label>
                      <input
                        type="password"
                        value={form.password}
                        onChange={(e) => updateForm(user.id, 'password', e.target.value)}
                        placeholder="Leave blank to keep current"
                        className={inputCls} />
                      <p className="text-[10px] text-[#B0B0B0] mt-1">
                        Only fill this to change the password.
                      </p>
                    </div>
                  </Section>

                  {(form.role === 'property_manager') &&
                  <Section icon={Home} title="Property Access" defaultOpen={true}>
                    <p className="text-[11px] text-[#B0B0B0] mb-3">
                      Select which properties this user can manage.
                    </p>
                    <div className="space-y-2 border border-[#EBEBEB] rounded-[8px] p-3">
                      {properties.map((prop) =>
                        <label key={prop.id} className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={form.property_ids.includes(prop.id)}
                            onChange={() => toggleProperty(user.id, prop.id)}
                            className="w-4 h-4 rounded border-[#EBEBEB] text-[#007AFF] focus:ring-[#007AFF]" />
                          <span className="text-[13px] md:text-[14px] text-[#222222]">
                            {prop.name}
                          </span>
                        </label>
                      )}
                      {properties.length === 0 &&
                        <p className="text-[12px] text-[#717171]">No properties available.</p>
                      }
                    </div>
                  </Section>
                  }
                </div>

                {/* Action buttons */}
                <div className="flex justify-between items-center pt-3">
                  <button
                    onClick={() => handleDeactivate(user.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] md:text-[13px] font-medium bg-white border border-[#FCA5A5] rounded-[8px] hover:bg-[#FEF2F2] text-[#DC2626]">
                    <UserX className="w-3.5 h-3.5" />
                    Deactivate
                  </button>
                  <button
                    onClick={() => handleSave(user.id)}
                    className="flex items-center gap-1.5 px-4 py-2 text-[12px] md:text-[13px] font-semibold text-white bg-[#007AFF] rounded-[8px] hover:bg-[#0066CC]">
                    <Save className="w-3.5 h-3.5" />
                    {savingId === user.id ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </div>
              }
            </div>);
        })}
      </div>

      {/* Add User Form */}
      {showAddForm &&
      <div className="bg-white rounded-[12px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] border border-[#EBEBEB] overflow-hidden">
        <div className="p-4 md:p-5 border-b border-[#EBEBEB] flex justify-between items-center bg-[#F7F7F7]">
          <h2 className="text-[15px] md:text-[16px] font-semibold text-[#222222]">
            Add New User
          </h2>
          <button
            onClick={() => { setShowAddForm(false); setAddError(''); }}
            className="text-[#717171] hover:text-[#222222]">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4 md:p-6 space-y-5 md:space-y-6">
          {addError &&
            <div className="bg-[#FEF2F2] border border-[#FCA5A5] rounded-[8px] px-3 py-2 text-[13px] text-[#991B1B]">
              {addError}
            </div>
          }
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-5">
            <div>
              <label className="block text-[12px] md:text-[13px] font-medium text-[#222222] mb-1.5">
                Name
              </label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Full name"
                className="w-full h-10 px-3 border border-[#EBEBEB] rounded-[8px] text-[13px] md:text-[14px] focus:outline-none focus:border-[#007AFF] focus:ring-1 focus:ring-[#007AFF]" />
            </div>
            <div>
              <label className="block text-[12px] md:text-[13px] font-medium text-[#222222] mb-1.5">
                Email
              </label>
              <input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="user@company.com"
                className="w-full h-10 px-3 border border-[#EBEBEB] rounded-[8px] text-[13px] md:text-[14px] focus:outline-none focus:border-[#007AFF] focus:ring-1 focus:ring-[#007AFF]" />
            </div>
            <div>
              <label className="block text-[12px] md:text-[13px] font-medium text-[#222222] mb-1.5">
                Password
              </label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full h-10 px-3 border border-[#EBEBEB] rounded-[8px] text-[13px] md:text-[14px] focus:outline-none focus:border-[#007AFF] focus:ring-1 focus:ring-[#007AFF]" />
            </div>
          </div>

          <div>
            <label className="block text-[12px] md:text-[13px] font-medium text-[#222222] mb-1.5">
              Role
            </label>
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value)}
              className="w-full sm:w-64 h-10 px-3 border border-[#EBEBEB] rounded-[8px] text-[13px] md:text-[14px] focus:outline-none focus:border-[#007AFF] focus:ring-1 focus:ring-[#007AFF] bg-white">
              <option value="admin">Admin</option>
              <option value="property_manager">Property Manager</option>
            </select>
          </div>

          {newRole === 'property_manager' &&
          <div>
            <label className="block text-[12px] md:text-[13px] font-medium text-[#222222] mb-2">
              Assign to Properties
            </label>
            <div className="space-y-2 border border-[#EBEBEB] rounded-[8px] p-3">
              {properties.map((prop) =>
                <label key={prop.id} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newPropertyIds.includes(prop.id)}
                    onChange={() => {
                      setNewPropertyIds((prev) =>
                        prev.includes(prop.id) ? prev.filter(id => id !== prop.id) : [...prev, prop.id]
                      );
                    }}
                    className="w-4 h-4 rounded border-[#EBEBEB] text-[#007AFF] focus:ring-[#007AFF]" />
                  <span className="text-[13px] md:text-[14px] text-[#222222]">
                    {prop.name}
                  </span>
                </label>
              )}
            </div>
          </div>
          }

          <div className="flex flex-col-reverse sm:flex-row justify-end gap-3 pt-4 border-t border-[#F0F0F0]">
            <button
              onClick={() => { setShowAddForm(false); setAddError(''); }}
              className="w-full sm:w-auto px-4 py-2 text-[13px] md:text-[14px] font-semibold text-[#222222] bg-white border border-[#EBEBEB] rounded-[8px] hover:bg-[#F7F7F7]">
              Cancel
            </button>
            <button
              onClick={handleAdd}
              disabled={adding}
              className="w-full sm:w-auto px-4 py-2 text-[13px] md:text-[14px] font-semibold text-white bg-[#007AFF] rounded-[8px] hover:bg-[#0066CC] shadow-[0_1px_3px_rgba(0,122,255,0.3)] disabled:opacity-50">
              {adding ? 'Adding...' : 'Add User'}
            </button>
          </div>
        </div>
      </div>
      }

      {users.length === 0 && !showAddForm &&
      <div className="bg-white rounded-[10px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] border border-[#EBEBEB] p-8 text-center text-[13px] text-[#717171]">
        No users found. Click "Add User" to create one.
      </div>
      }
    </div>);
}
