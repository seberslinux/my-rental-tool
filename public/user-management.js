let users = [];
let properties = [];

async function api(url, opts = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (res.status === 401) { window.location.href = '/login.html'; return null; }
  return res.json();
}

async function loadData() {
  [users, properties] = await Promise.all([
    api('/api/users'),
    api('/api/properties')
  ]);
  if (!users || !properties) return;
  renderUsers();
  renderPropertyCheckboxes();
}

function renderUsers() {
  const tbody = document.getElementById('usersTable');
  if (!users.length) {
    tbody.innerHTML = '<tr><td colspan="6">No users found.</td></tr>';
    return;
  }

  const roleLabels = { admin: 'Admin', property_manager: 'Property Manager', cleaner: 'Cleaner' };

  tbody.innerHTML = users.map(u => {
    const propNames = (u.property_ids || []).map(pid => {
      const p = properties.find(pr => pr.id === pid);
      return p ? escHtml(p.name) : `#${pid}`;
    }).join(', ');

    return `<tr class="${u.active ? '' : 'inactive-row'}">
      <td>${escHtml(u.name)}</td>
      <td>${escHtml(u.email)}</td>
      <td><span class="badge badge-${u.role}">${roleLabels[u.role] || u.role}</span></td>
      <td>${u.active ? '<span class="badge badge-active">Active</span>' : '<span class="badge badge-inactive">Inactive</span>'}</td>
      <td>${u.role === 'property_manager' ? propNames || '<em>None</em>' : '-'}</td>
      <td>
        <button class="btn btn-sm btn-secondary" onclick="editUser(${u.id})">Edit</button>
        ${u.active
          ? `<button class="btn btn-sm btn-danger" onclick="deactivateUser(${u.id})">Deactivate</button>`
          : `<button class="btn btn-sm btn-primary" onclick="reactivateUser(${u.id})">Reactivate</button>`}
      </td>
    </tr>`;
  }).join('');
}

function renderPropertyCheckboxes() {
  const container = document.getElementById('propertyCheckboxes');
  container.innerHTML = properties.map(p =>
    `<label><input type="checkbox" value="${p.id}"> ${escHtml(p.name)}</label>`
  ).join('');
}

function togglePropertyAccess() {
  const role = document.getElementById('userRole').value;
  document.getElementById('propertyAccessGroup').style.display = role === 'property_manager' ? 'block' : 'none';
}

function showAddForm() {
  document.getElementById('formTitle').textContent = 'Add User';
  document.getElementById('editUserId').value = '';
  document.getElementById('userForm').reset();
  document.getElementById('userEmail').disabled = false;
  togglePropertyAccess();
  document.getElementById('userFormCard').style.display = 'block';
}

function hideForm() {
  document.getElementById('userFormCard').style.display = 'none';
}

function editUser(id) {
  const u = users.find(x => x.id === id);
  if (!u) return;

  document.getElementById('formTitle').textContent = 'Edit User';
  document.getElementById('editUserId').value = u.id;
  document.getElementById('userName').value = u.name;
  document.getElementById('userEmail').value = u.email;
  document.getElementById('userEmail').disabled = true;
  document.getElementById('userRole').value = u.role;
  document.getElementById('userPassword').value = '';
  togglePropertyAccess();

  // Check assigned properties
  document.querySelectorAll('#propertyCheckboxes input').forEach(cb => {
    cb.checked = (u.property_ids || []).includes(parseInt(cb.value));
  });

  document.getElementById('userFormCard').style.display = 'block';
}

async function saveUser(e) {
  e.preventDefault();
  // Clear previous errors
  document.querySelectorAll('#userForm .field-error').forEach(el => el.remove());
  document.querySelectorAll('#userForm input').forEach(el => el.style.borderColor = '');

  const nameVal = document.getElementById('userName').value.trim();
  const emailVal = document.getElementById('userEmail').value.trim();
  let hasError = false;

  if (!nameVal) {
    const el = document.getElementById('userName');
    el.style.borderColor = '#dc2626';
    el.insertAdjacentHTML('afterend', '<div class="field-error" style="color:#dc2626;font-size:0.8rem;margin-top:0.2rem;">Name is required</div>');
    if (!hasError) el.focus();
    hasError = true;
  }
  if (!emailVal) {
    const el = document.getElementById('userEmail');
    el.style.borderColor = '#dc2626';
    el.insertAdjacentHTML('afterend', '<div class="field-error" style="color:#dc2626;font-size:0.8rem;margin-top:0.2rem;">Email is required</div>');
    if (!hasError) el.focus();
    hasError = true;
  }
  if (hasError) return;

  const editId = document.getElementById('editUserId').value;
  const body = {
    name: nameVal,
    email: emailVal,
    role: document.getElementById('userRole').value,
  };

  const pw = document.getElementById('userPassword').value;
  if (pw) body.password = pw;

  if (body.role === 'property_manager') {
    body.property_ids = Array.from(document.querySelectorAll('#propertyCheckboxes input:checked'))
      .map(cb => parseInt(cb.value));
  }

  const url = editId ? `/api/users/${editId}` : '/api/users';
  const method = editId ? 'PUT' : 'POST';

  const result = await api(url, { method, body: JSON.stringify(body) });
  if (result && !result.error) {
    hideForm();
    loadData();
  } else if (result) {
    alert(result.error);
  }
}

async function deactivateUser(id) {
  if (!confirm('Deactivate this user? They will no longer be able to log in.')) return;
  await api(`/api/users/${id}`, { method: 'DELETE' });
  loadData();
}

async function reactivateUser(id) {
  await api(`/api/users/${id}`, { method: 'PUT', body: JSON.stringify({ active: 1 }) });
  loadData();
}

document.addEventListener('DOMContentLoaded', async () => {
  const user = await checkAuth();
  if (!user) return;
  if (user.role !== 'admin') {
    document.querySelector('.container').innerHTML = '<h1>Access Denied</h1><p>Only admins can manage users.</p>';
    return;
  }
  loadData();
});
