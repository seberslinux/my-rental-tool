/* properties.js – Property Settings page */

async function api(url, opts = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (res.status === 401) { window.location.href = '/login.html'; return null; }
  return res.json();
}

async function fetchCosts(propertyId) {
  try {
    const data = await api(`/api/finances/costs/${propertyId}`);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function renderCostsTable(costs) {
  if (!costs || costs.length === 0) {
    return '<p style="color:var(--gray-400);font-size:0.85rem;">No fixed costs configured.</p>';
  }
  let html = '<table style="width:100%;font-size:0.85rem;border-collapse:collapse;">';
  html += '<tr style="border-bottom:1px solid var(--gray-200);"><th style="text-align:left;padding:4px 8px;">Category</th><th style="text-align:right;padding:4px 8px;">Monthly (ZAR)</th></tr>';
  for (const c of costs) {
    html += `<tr style="border-bottom:1px solid var(--gray-100);"><td style="padding:4px 8px;">${escHtml(c.category || c.name || '')}</td><td style="text-align:right;padding:4px 8px;">${fmtMoney(c.monthly_amount || c.amount || 0)}</td></tr>`;
  }
  html += '</table>';
  return html;
}

function propertyTypeOptions(selected) {
  const types = ['apartment', 'house', 'villa', 'cabin', 'loft', 'studio', 'other'];
  return types.map(t =>
    `<option value="${t}"${(selected || '') === t ? ' selected' : ''}>${t.charAt(0).toUpperCase() + t.slice(1)}</option>`
  ).join('');
}

function renderPropertyCard(p, costs) {
  return `
    <div class="property-card" id="property-${p.id}" data-property-id="${p.id}">
      <form onsubmit="saveProperty(event, ${p.id})">
        <div class="property-header">
          <div>
            <h2>${escHtml(p.name)}</h2>
            <div class="id">Smoobu ID: ${p.smoobu_id}</div>
          </div>
          <div class="actions">
            <a href="property-detail.html?id=${p.id}" class="btn btn-outline" style="text-decoration:none;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
              View Performance
            </a>
            <button type="submit" class="btn btn-primary">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
              Save Changes
            </button>
          </div>
        </div>
        <div class="property-body">
          <div class="form-grid">
            <div class="form-group">
              <label>Property Type</label>
              <select name="property_type">
                <option value="">-- Select --</option>
                ${propertyTypeOptions(p.property_type)}
              </select>
            </div>
            <div class="form-group">
              <label>Bedrooms</label>
              <input type="number" name="bedrooms" value="${p.bedrooms != null ? p.bedrooms : ''}" min="0" max="50">
            </div>
            <div class="form-group">
              <label>Bathrooms</label>
              <input type="number" name="bathrooms" value="${p.bathrooms != null ? p.bathrooms : ''}" min="0" max="50" step="0.5">
            </div>
            <div class="form-group">
              <label>Max Guests</label>
              <input type="number" name="max_guests" value="${p.max_guests != null ? p.max_guests : ''}" min="1" max="100">
            </div>
          </div>

          <!-- Location Section -->
          <div class="form-section">
            <h3>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
              Location
            </h3>
            <div class="form-grid">
              <div class="form-group span-4">
                <label>Address</label>
                <input type="text" name="address" value="${escHtml(p.address || '')}" placeholder="Property address for cleaners">
              </div>
              <div class="form-group span-2">
                <label>Location</label>
                <input type="text" name="location" value="${escHtml(p.location || '')}" placeholder="e.g. Cape Town">
              </div>
              <div class="form-group span-2">
                <label>Neighbourhood</label>
                <input type="text" name="neighbourhood" value="${escHtml(p.neighbourhood || '')}" placeholder="e.g. Sea Point">
              </div>
            </div>
          </div>

          <!-- Cleaning Section -->
          <div class="form-section">
            <h3>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
              Cleaning
            </h3>
            <div class="form-grid">
              <div class="form-group">
                <label>Cleaning Hours Required</label>
                <input type="number" name="cleaning_hours_required" value="${p.cleaning_hours_required != null ? p.cleaning_hours_required : ''}" step="0.5" min="0.5" max="12">
              </div>
            </div>
          </div>

          <!-- Pricing Section -->
          <div class="form-section">
            <h3>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M16 8h-4a2 2 0 100 4h2a2 2 0 110 4H8"/></svg>
              Pricing
            </h3>
            <div class="form-grid">
              <div class="form-group">
                <label>Base Nightly Price</label>
                <input type="number" name="base_price" value="${p.base_price != null ? p.base_price : ''}" step="50" min="0"${!p.base_price ? ' style="border-color:var(--warning);"' : ''}>
              </div>
              <div class="form-group">
                <label>Base Currency</label>
                <select name="base_currency">
                  ${['ZAR','EUR','USD','GBP'].map(c => `<option value="${c}"${(p.base_currency || 'ZAR') === c ? ' selected' : ''}>${CURRENCY_SYMBOLS[c] || c} - ${c}</option>`).join('')}
                </select>
              </div>
            </div>
          </div>

          <!-- Platform Listings Section -->
          <div class="form-section">
            <h3>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>
              Platform Listings
            </h3>
            <p style="color:var(--gray-400);font-size:0.8rem;margin-bottom:16px;margin-top:-8px;">URLs for review scraping and market comparison</p>
            <div class="form-grid">
              <div class="form-group span-2">
                <label>Airbnb URL</label>
                <input type="url" name="airbnb_url" value="${escHtml(p.airbnb_url || '')}" placeholder="https://www.airbnb.com/rooms/...">
              </div>
              <div class="form-group span-2">
                <label>Airbnb Listing ID</label>
                <input type="text" name="airbnb_id" value="${escHtml(p.airbnb_id || '')}" placeholder="e.g. 12345678">
              </div>
              <div class="form-group span-2">
                <label>Booking.com URL</label>
                <input type="url" name="booking_url" value="${escHtml(p.booking_url || '')}" placeholder="https://www.booking.com/hotel/...">
              </div>
              <div class="form-group span-2">
                <label>Booking.com Property ID</label>
                <input type="text" name="booking_id_ext" value="${escHtml(p.booking_id_ext || '')}" placeholder="e.g. 987654">
              </div>
              <div class="form-group span-2">
                <label>VRBO URL</label>
                <input type="url" name="vrbo_url" value="${escHtml(p.vrbo_url || '')}" placeholder="https://www.vrbo.com/...">
              </div>
              <div class="form-group span-2">
                <label>VRBO Listing ID</label>
                <input type="text" name="vrbo_id" value="${escHtml(p.vrbo_id || '')}" placeholder="e.g. 1122334">
              </div>
            </div>
          </div>

          <!-- Platform Commissions Section -->
          <div class="form-section">
            <h3>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
              Platform Commissions
            </h3>
            <p style="color:var(--gray-400);font-size:0.8rem;margin-bottom:16px;margin-top:-8px;">Used to estimate platform fees in the P&amp;L view</p>
            <div class="form-grid">
              <div class="form-group">
                <label>Airbnb Commission %</label>
                <input type="number" name="commission_airbnb" value="${p.commission_airbnb != null ? p.commission_airbnb : 18}" step="0.5" min="0" max="100">
              </div>
              <div class="form-group">
                <label>Booking.com Commission %</label>
                <input type="number" name="commission_booking" value="${p.commission_booking != null ? p.commission_booking : 15}" step="0.5" min="0" max="100">
              </div>
              <div class="form-group">
                <label>VRBO Commission %</label>
                <input type="number" name="commission_vrbo" value="${p.commission_vrbo != null ? p.commission_vrbo : 8}" step="0.5" min="0" max="100">
              </div>
            </div>
            <h4 style="font-size:0.85rem;color:var(--gray-600);margin:16px 0 8px;">Bank Charges</h4>
            <div class="form-grid">
              <div class="form-group">
                <label>Airbnb Bank Charge %</label>
                <input type="number" name="bank_charge_airbnb" value="${p.bank_charge_airbnb != null ? p.bank_charge_airbnb : 0}" step="0.1" min="0" max="100">
              </div>
              <div class="form-group">
                <label>Booking.com Bank Charge %</label>
                <input type="number" name="bank_charge_booking" value="${p.bank_charge_booking != null ? p.bank_charge_booking : 2.1}" step="0.1" min="0" max="100">
              </div>
              <div class="form-group">
                <label>VRBO Bank Charge %</label>
                <input type="number" name="bank_charge_vrbo" value="${p.bank_charge_vrbo != null ? p.bank_charge_vrbo : 0}" step="0.1" min="0" max="100">
              </div>
            </div>
            <h4 style="font-size:0.85rem;color:var(--gray-600);margin:16px 0 8px;">Tax</h4>
            <div class="form-grid">
              <div class="form-group">
                <label>VAT Rate % (for VAT-inclusive platforms)</label>
                <input type="number" name="vat_rate" value="${p.vat_rate != null ? p.vat_rate : 0}" step="0.5" min="0" max="100">
                <small style="color:var(--gray-400);font-size:0.75rem;">Set to 14 if Booking.com rates include VAT. Used for accurate cross-platform ADR comparison.</small>
              </div>
            </div>
          </div>

          <!-- Monthly Fixed Costs Summary -->
          <div class="form-section">
            <h3>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
              Monthly Fixed Costs
            </h3>
            <div id="costs-${p.id}">${renderCostsTable(costs)}</div>
            <p style="margin-top:0.75rem;"><a href="/finances.html" style="font-size:0.85rem;color:var(--primary);">Edit in Finances &rarr; Cost Settings</a></p>
          </div>

          <!-- Guest & Operations Info (collapsible) -->
          <div class="form-section">
            <div onclick="toggleGuestInfo(${p.id})" style="cursor:pointer;display:flex;align-items:center;justify-content:space-between;user-select:none;">
              <h3 style="margin-bottom:0;">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                Guest &amp; Operations Info
              </h3>
              <span id="guestInfoToggle-${p.id}" style="font-size:1.2rem;color:var(--gray-400);transition:transform 0.2s;">&#9654;</span>
            </div>
            <div id="guestInfoPanel-${p.id}" style="display:none;margin-top:16px;">
              <div class="form-grid">
                <div class="form-group span-2">
                  <label>WiFi Network</label>
                  <input type="text" name="wifi_network" value="${escHtml(p.wifi_network || '')}" placeholder="Network name">
                </div>
                <div class="form-group span-2">
                  <label>WiFi Password</label>
                  <div style="position:relative;">
                    <input type="password" name="wifi_password" value="${escHtml(p.wifi_password || '')}" placeholder="Password" style="padding-right:3rem;">
                    <button type="button" onclick="togglePasswordField(this)" style="position:absolute;right:4px;top:50%;transform:translateY(-50%);background:none;border:1px solid var(--gray-200);border-radius:4px;padding:2px 8px;font-size:0.75rem;cursor:pointer;color:var(--gray-500);">Show</button>
                  </div>
                </div>
                <div class="form-group span-2">
                  <label>Door/Key Code</label>
                  <div style="position:relative;">
                    <input type="password" name="access_code" value="${escHtml(p.access_code || '')}" placeholder="Access code" style="padding-right:3rem;">
                    <button type="button" onclick="togglePasswordField(this)" style="position:absolute;right:4px;top:50%;transform:translateY(-50%);background:none;border:1px solid var(--gray-200);border-radius:4px;padding:2px 8px;font-size:0.75rem;cursor:pointer;color:var(--gray-500);">Show</button>
                  </div>
                </div>
                <div class="form-group span-2">
                  <label>Emergency Contact</label>
                  <input type="text" name="emergency_contact" value="${escHtml(p.emergency_contact || '')}" placeholder="Name & phone number">
                </div>
                <div class="form-group span-4">
                  <label>Check-in Instructions</label>
                  <textarea name="checkin_instructions" rows="3" placeholder="Instructions for guest check-in">${escHtml(p.checkin_instructions || '')}</textarea>
                </div>
                <div class="form-group span-4">
                  <label>Check-out Instructions</label>
                  <textarea name="checkout_instructions" rows="3" placeholder="Instructions for guest check-out">${escHtml(p.checkout_instructions || '')}</textarea>
                </div>
                <div class="form-group span-4">
                  <label>Supply Checklist</label>
                  <textarea name="supply_checklist" rows="4" placeholder="One item per line, e.g.:\nToilet paper\nSoap\nTowels">${escHtml(p.supply_checklist || '')}</textarea>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="property-footer">
          <span class="save-status" id="status-${p.id}" style="font-size:13px;"></span>
          <button type="submit" class="btn btn-primary">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
            Save Settings
          </button>
        </div>
      </form>
    </div>`;
}

function toggleGuestInfo(propertyId) {
  const panel = document.getElementById(`guestInfoPanel-${propertyId}`);
  const toggle = document.getElementById(`guestInfoToggle-${propertyId}`);
  if (!panel) return;
  const open = panel.style.display !== 'none';
  panel.style.display = open ? 'none' : 'block';
  if (toggle) toggle.style.transform = open ? '' : 'rotate(90deg)';
}

function togglePasswordField(btn) {
  const input = btn.parentElement.querySelector('input');
  if (!input) return;
  if (input.type === 'password') {
    input.type = 'text';
    btn.textContent = 'Hide';
  } else {
    input.type = 'password';
    btn.textContent = 'Show';
  }
}

async function loadProperties() {
  const container = document.getElementById('propertiesList');
  try {
    const properties = await api('/api/properties');
    if (properties.length === 0) {
      container.innerHTML =
        '<div class="alert-banner warning">No properties found. Go to Dashboard and click "Sync" first.</div>';
      return;
    }

    // Filter by selected properties
    const ids = getSelectedPropertyIds();
    const filtered = ids.includes('all')
      ? properties
      : properties.filter(p => ids.includes(String(p.id)));

    if (filtered.length === 0) {
      container.innerHTML = '<div class="alert-banner warning">No matching property found.</div>';
      return;
    }

    // Fetch costs for each property in parallel
    const costsMap = {};
    await Promise.all(filtered.map(async (p) => {
      costsMap[p.id] = await fetchCosts(p.id);
    }));

    container.innerHTML = filtered.map(p => renderPropertyCard(p, costsMap[p.id])).join('');
  } catch (err) {
    container.innerHTML = `<div class="alert-banner danger">Failed to load properties: ${err.message}</div>`;
  }
}

async function saveProperty(event, id) {
  event.preventDefault();
  const form = event.target;
  const status = document.getElementById(`status-${id}`);

  const data = {
    address: form.address.value,
    cleaning_hours_required: form.cleaning_hours_required.value ? parseFloat(form.cleaning_hours_required.value) : null,
    base_price: form.base_price.value ? parseFloat(form.base_price.value) : null,
    base_currency: form.base_currency.value || 'ZAR',
    airbnb_url: form.airbnb_url.value,
    airbnb_id: form.airbnb_id.value,
    booking_url: form.booking_url.value,
    booking_id_ext: form.booking_id_ext.value,
    vrbo_url: form.vrbo_url.value,
    vrbo_id: form.vrbo_id.value,
    commission_airbnb: form.commission_airbnb.value ? parseFloat(form.commission_airbnb.value) : null,
    commission_booking: form.commission_booking.value ? parseFloat(form.commission_booking.value) : null,
    commission_vrbo: form.commission_vrbo.value ? parseFloat(form.commission_vrbo.value) : null,
    bank_charge_airbnb: form.bank_charge_airbnb.value ? parseFloat(form.bank_charge_airbnb.value) : 0,
    bank_charge_booking: form.bank_charge_booking.value ? parseFloat(form.bank_charge_booking.value) : 2.1,
    bank_charge_vrbo: form.bank_charge_vrbo.value ? parseFloat(form.bank_charge_vrbo.value) : 0,
    vat_rate: form.vat_rate.value ? parseFloat(form.vat_rate.value) : 0,
    property_type: form.property_type.value,
    bedrooms: form.bedrooms.value ? parseInt(form.bedrooms.value, 10) : null,
    bathrooms: form.bathrooms.value ? parseFloat(form.bathrooms.value) : null,
    max_guests: form.max_guests.value ? parseInt(form.max_guests.value, 10) : null,
    location: form.location.value,
    neighbourhood: form.neighbourhood.value,
    wifi_network: form.wifi_network.value,
    wifi_password: form.wifi_password.value,
    access_code: form.access_code.value,
    checkin_instructions: form.checkin_instructions.value,
    checkout_instructions: form.checkout_instructions.value,
    supply_checklist: form.supply_checklist.value,
    emergency_contact: form.emergency_contact.value,
  };

  status.textContent = 'Saving...';
  status.style.color = 'var(--gray-400)';

  try {
    await api(`/api/properties/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    status.textContent = 'Saved!';
    status.style.color = 'var(--success)';
    showToast('Settings saved!');
    setTimeout(() => (status.textContent = ''), 2000);
  } catch (err) {
    status.textContent = 'Save failed';
    status.style.color = 'var(--danger)';
    showToast('Error saving settings', 'error');
  }
}

// Sticky save bar - appears when user scrolls past first save button
function initStickySave() {
  let stickyBar = document.getElementById('stickySaveBar');
  if (!stickyBar) {
    stickyBar = document.createElement('div');
    stickyBar.id = 'stickySaveBar';
    stickyBar.style.cssText = 'position:fixed;bottom:0;left:var(--sidebar-width,240px);right:0;background:white;border-top:1px solid var(--gray-200);padding:12px 32px;display:none;justify-content:flex-end;align-items:center;gap:12px;z-index:100;box-shadow:0 -4px 12px rgba(0,0,0,0.08);';
    stickyBar.innerHTML = '<span style="color:var(--gray-500);font-size:13px;">Unsaved changes may exist</span><button class="btn btn-primary" onclick="saveNearestProperty()"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Save Settings</button>';
    document.body.appendChild(stickyBar);
  }

  const observer = new IntersectionObserver((entries) => {
    const anyVisible = entries.some(e => e.isIntersecting);
    stickyBar.style.display = anyVisible ? 'none' : 'flex';
  }, { threshold: 0 });

  setTimeout(() => {
    document.querySelectorAll('.property-footer button[type="submit"]').forEach(btn => observer.observe(btn));
  }, 500);
}

function saveNearestProperty() {
  const forms = document.querySelectorAll('#propertiesList form');
  for (const form of forms) {
    const rect = form.getBoundingClientRect();
    if (rect.top < window.innerHeight && rect.bottom > 0) {
      form.requestSubmit();
      return;
    }
  }
  if (forms.length > 0) forms[0].requestSubmit();
}

// Listen for property selector changes
window.addEventListener('propertyChanged', () => {
  loadProperties();
});

// Initial load (with auth check)
(async () => {
  const user = await checkAuth();
  if (!user) return;
  await loadProperties();
  initStickySave();

  // Deep-link to pricing section via URL hash
  if (window.location.hash === '#pricing') {
    setTimeout(() => {
      const pricingInput = document.querySelector('input[name="base_price"]');
      if (pricingInput) {
        pricingInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
        pricingInput.style.transition = 'box-shadow 0.3s';
        pricingInput.style.boxShadow = '0 0 0 3px rgba(245,158,11,0.5)';
        setTimeout(() => { pricingInput.style.boxShadow = ''; }, 2000);
      }
    }, 300);
  }
})();
