/* property-detail.js – Per-property performance page */

(async function () {
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');
  if (!id) {
    document.getElementById('propertyHeader').innerHTML =
      '<div class="alert alert-error">No property ID provided. <a href="/properties.html">Go back</a></div>';
    return;
  }

  let data;
  try {
    const res = await fetch('/api/properties/' + encodeURIComponent(id) + '/summary');
    if (!res.ok) throw new Error('Property not found');
    data = await res.json();
  } catch (err) {
    document.getElementById('propertyHeader').innerHTML =
      '<div class="alert alert-error">Failed to load property: ' + escHtml(err.message) + '</div>';
    return;
  }

  const prop = data.property;
  const kpis = data.kpis;

  // --- Header ---
  const typeBadge = prop.property_type
    ? prop.property_type.charAt(0).toUpperCase() + prop.property_type.slice(1)
    : '';
  document.title = escHtml(prop.name) + ' - Rental Manager';
  document.getElementById('propertyHeader').innerHTML =
    '<h1>' + escHtml(prop.name) + '</h1>' +
    '<div class="prop-meta">' +
      (typeBadge ? '<span>' + escHtml(typeBadge) + '</span>' : '') +
      (prop.bedrooms != null ? '<span>' + escHtml(String(prop.bedrooms)) + ' bed</span>' : '') +
      (prop.bathrooms != null ? '<span>' + escHtml(String(prop.bathrooms)) + ' bath</span>' : '') +
      (prop.max_guests != null ? '<span>' + escHtml(String(prop.max_guests)) + ' guests</span>' : '') +
      (prop.address ? '<span>' + escHtml(prop.address) + '</span>' : '') +
    '</div>';

  // --- KPIs ---
  var kpiItems = [
    { label: 'Revenue (30d)', value: 'R ' + fmtNum(kpis.revenue_30d) },
    { label: 'Occupancy (30d)', value: fmtNum(kpis.occupancy_30d) + '%' },
    { label: 'Avg Nightly Rate', value: 'R ' + fmtNum(kpis.avg_nightly_rate_30d) },
    { label: 'Net Profit (30d)', value: 'R ' + fmtNum(kpis.net_profit_30d) },
    { label: 'Cancellation Rate', value: fmtNum(kpis.cancellation_rate_30d) + '%' },
  ];
  document.getElementById('kpiGrid').innerHTML = kpiItems.map(function (k) {
    return '<div class="kpi-card"><div class="kpi-value">' + escHtml(k.value) + '</div><div class="kpi-label">' + escHtml(k.label) + '</div></div>';
  }).join('');

  // --- Monthly chart ---
  var monthly = data.monthly || [];
  var maxRev = Math.max.apply(null, monthly.map(function (m) { return m.revenue; }).concat([1]));
  var chartHtml = '';
  for (var i = 0; i < monthly.length; i++) {
    var m = monthly[i];
    var barH = maxRev > 0 ? Math.max(2, (m.revenue / maxRev) * 100) : 2;
    var label = fmtMonth(m.month);
    chartHtml +=
      '<div class="bar-col">' +
        '<div class="bar-value">R ' + fmtNum(m.revenue) + '</div>' +
        '<div class="bar" style="height:' + barH + '%;background:#1a1a2e;" title="' +
          escHtml(label) + ': R ' + fmtNum(m.revenue) + ' | Occ: ' + fmtNum(m.occupancy_pct) + '%"></div>' +
        '<div class="bar-label">' + escHtml(label) + '</div>' +
      '</div>';
  }
  document.getElementById('monthlyChart').innerHTML = chartHtml;

  // --- Upcoming bookings table ---
  var upcoming = data.upcoming_bookings || [];
  var tbody = document.getElementById('upcomingBody');
  if (upcoming.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#999;">No upcoming bookings</td></tr>';
  } else {
    tbody.innerHTML = upcoming.map(function (b) {
      return '<tr>' +
        '<td>' + escHtml(b.guest_name || 'Guest') + '</td>' +
        '<td>' + escHtml(b.check_in) + '</td>' +
        '<td>' + escHtml(b.check_out) + '</td>' +
        '<td>' + escHtml(String(b.nights || '')) + '</td>' +
        '<td>' + platformBadge(b.platform) + '</td>' +
        '<td>R ' + fmtNum(b.total_price) + '</td>' +
      '</tr>';
    }).join('');
  }

  // --- Recent reviews ---
  var reviews = data.recent_reviews || [];
  var reviewsContainer = document.getElementById('reviewsList');
  if (reviews.length === 0) {
    reviewsContainer.innerHTML = '<p style="color:#999;">No reviews yet.</p>';
  } else {
    reviewsContainer.innerHTML = reviews.map(function (r) {
      var stars = '';
      var fullStars = Math.floor(r.rating || 0);
      for (var s = 0; s < 5; s++) {
        stars += s < fullStars ? '\u2605' : '\u2606';
      }
      return '<div class="review-card">' +
        '<div class="stars">' + stars + ' <span style="font-size:0.85rem;color:#333;">' + fmtNum(r.rating) + '</span></div>' +
        '<div class="review-meta">' +
          escHtml(r.guest_name || 'Anonymous') + ' &middot; ' +
          escHtml(r.review_date || '') + ' &middot; ' +
          platformBadge(r.platform) +
        '</div>' +
        (r.comment ? '<div class="review-comment">' + escHtml(r.comment) + '</div>' : '') +
      '</div>';
    }).join('');
  }
})();
