/* properties.js – Property Settings page */

async function api(url, opts = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
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
    return '<p style="color:#999;font-size:0.85rem;">No fixed costs configured.</p>';
  }
  let html = '<table style="width:100%;font-size:0.85rem;border-collapse:collapse;">';
  html += '<tr style="border-bottom:1px solid #ddd;"><th style="text-align:left;padding:4px 8px;">Category</th><th style="text-align:right;padding:4px 8px;">Monthly (ZAR)</th></tr>';
  for (const c of costs) {
    html += `<tr style="border-bottom:1px solid #eee;"><td style="padding:4px 8px;">${escHtml(c.category || c.name || '')}</td><td style="text-align:right;padding:4px 8px;">R ${fmtNum(c.monthly_amount || c.amount || 0)}</td></tr>`;
  }
  html += '</table>';
  return html;
}

function propertyTypeOptions(selected) {
  const types = ['apartment', 'house', 'villa', 'cabin', 'other'];
  return types.map(t =>
    `<option value="${t}"${(selected || '') === t ? ' selected' : ''}>${t.charAt(0).toUpperCase() + t.slice(1)}</option>`
  ).join('');
}

function renderPropertyCard(p, costs) {
  return `
    <div class="card" id="property-${p.id}" data-property-id="${p.id}">
      <form onsubmit="saveProperty(event, ${p.id})">

        <!-- Basic Info -->
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:0.5rem;">
          <div>
            <h2 style="margin-bottom:0.25rem;">${escHtml(p.name)}</h2>
            <p style="color:#999;font-size:0.85rem;margin-bottom:0;">Smoobu ID: ${p.smoobu_id}</p>
          </div>
          <a href="property-detail.html?id=${p.id}" class="btn btn-primary btn-sm" style="white-space:nowrap;text-decoration:none;">View Performance</a>
        </div>

        <div class="form-row">
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

        <!-- Location -->
        <h3 style="margin-top:1.5rem;margin-bottom:0.5rem;">Location</h3>
        <div class="form-row">
          <div class="form-group" style="flex:2;">
            <label>Address</label>
            <input type="text" name="address" value="${escHtml(p.address || '')}" placeholder="Property address for cleaners">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Location</label>
            <input type="text" name="location" value="${escHtml(p.location || '')}" placeholder="e.g. Cape Town">
          </div>
          <div class="form-group">
            <label>Neighbourhood</label>
            <input type="text" name="neighbourhood" value="${escHtml(p.neighbourhood || '')}" placeholder="e.g. Sea Point">
          </div>
        </div>

        <!-- Cleaning -->
        <h3 style="margin-top:1.5rem;margin-bottom:0.5rem;">Cleaning</h3>
        <div class="form-row">
          <div class="form-group">
            <label>Cleaning Hours Required</label>
            <input type="number" name="cleaning_hours_required" value="${p.cleaning_hours_required != null ? p.cleaning_hours_required : ''}" step="0.5" min="0.5" max="12">
          </div>
        </div>

        <!-- Pricing -->
        <h3 style="margin-top:1.5rem;margin-bottom:0.5rem;">Pricing</h3>
        <div class="form-row">
          <div class="form-group">
            <label>Base Nightly Price (ZAR)</label>
            <input type="number" name="base_price" value="${p.base_price != null ? p.base_price : ''}" step="50" min="0">
          </div>
        </div>

        <!-- Platform Listings -->
        <h3 style="margin-top:1.5rem;margin-bottom:0.5rem;">Platform Listings</h3>
        <p style="color:#999;font-size:0.8rem;margin-bottom:0.75rem;">These URLs are used for review scraping and market comparison</p>
        <div class="form-row">
          <div class="form-group" style="flex:2;">
            <label>Airbnb URL</label>
            <input type="url" name="airbnb_url" value="${escHtml(p.airbnb_url || '')}" placeholder="https://www.airbnb.com/rooms/...">
          </div>
          <div class="form-group">
            <label>Airbnb Listing ID</label>
            <input type="text" name="airbnb_id" value="${escHtml(p.airbnb_id || '')}" placeholder="e.g. 12345678">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group" style="flex:2;">
            <label>Booking.com URL</label>
            <input type="url" name="booking_url" value="${escHtml(p.booking_url || '')}" placeholder="https://www.booking.com/hotel/...">
          </div>
          <div class="form-group">
            <label>Booking.com Property ID</label>
            <input type="text" name="booking_id_ext" value="${escHtml(p.booking_id_ext || '')}" placeholder="e.g. 987654">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group" style="flex:2;">
            <label>VRBO URL</label>
            <input type="url" name="vrbo_url" value="${escHtml(p.vrbo_url || '')}" placeholder="https://www.vrbo.com/...">
          </div>
          <div class="form-group">
            <label>VRBO Listing ID</label>
            <input type="text" name="vrbo_id" value="${escHtml(p.vrbo_id || '')}" placeholder="e.g. 1122334">
          </div>
        </div>

        <!-- Platform Commissions -->
        <h3 style="margin-top:1.5rem;margin-bottom:0.5rem;">Platform Commissions</h3>
        <p style="color:#999;font-size:0.8rem;margin-bottom:0.75rem;">Used to estimate platform fees in the P&amp;L view</p>
        <div class="form-row">
          <div class="form-group">
            <label>Airbnb Commission %</label>
            <input type="number" name="commission_airbnb" value="${p.commission_airbnb != null ? p.commission_airbnb : 3}" step="0.5" min="0" max="100">
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

        <!-- Monthly Fixed Costs Summary -->
        <h3 style="margin-top:1.5rem;margin-bottom:0.5rem;">Monthly Fixed Costs Summary</h3>
        <div id="costs-${p.id}">${renderCostsTable(costs)}</div>
        <p style="margin-top:0.5rem;"><a href="/finances.html" style="font-size:0.85rem;">Edit in Finances &rarr; Cost Settings</a></p>

        <!-- Guest & Operations Info (collapsible) -->
        <div style="margin-top:1.5rem;border:1px solid #ddd;border-radius:6px;overflow:hidden;">
          <div onclick="toggleGuestInfo(${p.id})" style="cursor:pointer;padding:0.75rem 1rem;background:#f8f8f8;display:flex;align-items:center;justify-content:space-between;user-select:none;">
            <h3 style="margin:0;">Guest &amp; Operations Info</h3>
            <span id="guestInfoToggle-${p.id}" style="font-size:1.2rem;transition:transform 0.2s;">&#9654;</span>
          </div>
          <div id="guestInfoPanel-${p.id}" style="display:none;padding:1rem;">
            <div class="form-row">
              <div class="form-group">
                <label>WiFi Network</label>
                <input type="text" name="wifi_network" value="${escHtml(p.wifi_network || '')}" placeholder="Network name">
              </div>
              <div class="form-group">
                <label>WiFi Password</label>
                <div style="position:relative;">
                  <input type="password" name="wifi_password" value="${escHtml(p.wifi_password || '')}" placeholder="Password" style="padding-right:3rem;">
                  <button type="button" onclick="togglePasswordField(this)" style="position:absolute;right:4px;top:50%;transform:translateY(-50%);background:none;border:1px solid #ccc;border-radius:3px;padding:2px 6px;font-size:0.75rem;cursor:pointer;">Show</button>
                </div>
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Door/Key Code</label>
                <div style="position:relative;">
                  <input type="password" name="access_code" value="${escHtml(p.access_code || '')}" placeholder="Access code" style="padding-right:3rem;">
                  <button type="button" onclick="togglePasswordField(this)" style="position:absolute;right:4px;top:50%;transform:translateY(-50%);background:none;border:1px solid #ccc;border-radius:3px;padding:2px 6px;font-size:0.75rem;cursor:pointer;">Show</button>
                </div>
              </div>
              <div class="form-group">
                <label>Emergency Contact</label>
                <input type="text" name="emergency_contact" value="${escHtml(p.emergency_contact || '')}" placeholder="Name & phone number">
              </div>
            </div>
            <div class="form-row">
              <div class="form-group" style="flex:1;">
                <label>Check-in Instructions</label>
                <textarea name="checkin_instructions" rows="3" placeholder="Instructions for guest check-in">${escHtml(p.checkin_instructions || '')}</textarea>
              </div>
            </div>
            <div class="form-row">
              <div class="form-group" style="flex:1;">
                <label>Check-out Instructions</label>
                <textarea name="checkout_instructions" rows="3" placeholder="Instructions for guest check-out">${escHtml(p.checkout_instructions || '')}</textarea>
              </div>
            </div>
            <div class="form-row">
              <div class="form-group" style="flex:1;">
                <label>Supply Checklist</label>
                <textarea name="supply_checklist" rows="4" placeholder="One item per line, e.g.:\nToilet paper\nSoap\nTowels">${escHtml(p.supply_checklist || '')}</textarea>
              </div>
            </div>
          </div>
        </div>

        <div class="actions" style="margin-top:1.5rem;">
          <button type="submit" class="btn btn-primary">Save Settings</button>
          <span class="save-status" id="status-${p.id}"></span>
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
        '<div class="alert alert-info">No properties found. Go to Dashboard and click "Sync Properties" first.</div>';
      return;
    }

    // Filter by selected properties
    const ids = getSelectedPropertyIds();
    const filtered = ids.includes('all')
      ? properties
      : properties.filter(p => ids.includes(String(p.id)));

    if (filtered.length === 0) {
      container.innerHTML = '<div class="alert alert-info">No matching property found.</div>';
      return;
    }

    // Fetch costs for each property in parallel
    const costsMap = {};
    await Promise.all(filtered.map(async (p) => {
      costsMap[p.id] = await fetchCosts(p.id);
    }));

    container.innerHTML = filtered.map(p => renderPropertyCard(p, costsMap[p.id])).join('');
  } catch (err) {
    container.innerHTML = `<div class="alert alert-error">Failed to load properties: ${err.message}</div>`;
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
    airbnb_url: form.airbnb_url.value,
    airbnb_id: form.airbnb_id.value,
    booking_url: form.booking_url.value,
    booking_id_ext: form.booking_id_ext.value,
    vrbo_url: form.vrbo_url.value,
    vrbo_id: form.vrbo_id.value,
    commission_airbnb: form.commission_airbnb.value ? parseFloat(form.commission_airbnb.value) : null,
    commission_booking: form.commission_booking.value ? parseFloat(form.commission_booking.value) : null,
    commission_vrbo: form.commission_vrbo.value ? parseFloat(form.commission_vrbo.value) : null,
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
  status.style.color = '#999';

  try {
    await api(`/api/properties/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    status.textContent = 'Saved!';
    status.style.color = '#006600';
    setTimeout(() => (status.textContent = ''), 2000);
  } catch (err) {
    status.textContent = 'Save failed';
    status.style.color = '#cc0000';
  }
}

// Listen for property selector changes
window.addEventListener('propertyChanged', () => {
  loadProperties();
});

// Initial load
loadProperties();
