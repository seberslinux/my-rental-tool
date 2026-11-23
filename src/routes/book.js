/**
 * The website's booking page, one per property: /book/<slug>.
 *
 * Public. The page shows a calendar of free nights, the price for the
 * chosen stay, and a short form; paying hands the guest to Paystack. The
 * price is worked out here every time — nothing the browser sends sets it.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const site = require('../services/website-booking');
const { page, esc, baseUrl } = require('./pay');

// Making a booking starts a checkout; a handful an hour from one address
// is plenty for a real guest. Off in tests, like the app's other limits.
function bookRouter({ disableRateLimits = false } = {}) {
const router = express.Router();
const reserveLimiter = disableRateLimits ? (req, res, next) => next() : rateLimit({
  windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many attempts — please try again later, or contact us.' },
});

const notFound = (res) => res.status(404).send(page('Not available', '<div class="card"><h1>Not available</h1><p class="muted">This property cannot be booked here at the moment. Please contact us.</p></div>'));
const fail = (res, err) => {
  if (!err.status || err.status >= 500) console.error('book:', err.message);
  res.status(err.status && err.status < 500 ? err.status : 500).json({ error: err.status && err.status < 500 ? err.message : 'Something went wrong — please try again in a moment.' });
};

router.get('/:slug', async (req, res) => {
  try {
    const p = await site.bySlug(req.params.slug);
    res.set('Cache-Control', 'no-store');
    if (!p) return notFound(res);
    const max = Number(p.max_guests) || 4;
    const terms = p.booking_terms ? `<details class="terms"><summary>Booking terms</summary><div>${esc(p.booking_terms).replace(/\n/g, '<br>')}</div></details>
      <label class="check"><input type="checkbox" id="agreed"> I accept the booking terms</label>` : '';
    const options = (from, to, sel) => Array.from({ length: to - from + 1 }, (_, i) => from + i).map((n) => `<option${n === sel ? ' selected' : ''}>${n}</option>`).join('');
    res.send(page(`Book ${p.name}`, `
<style>
  .cal { margin-top:16px } .cal-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:8px }
  .cal-head button { width:40px; height:40px; margin:0; background:#fff; color:var(--ink); border:1px solid var(--line); border-radius:50%; font-size:18px }
  .cal-head button:disabled { opacity:.3 } .grid { display:grid; grid-template-columns:repeat(7,1fr); gap:2px; text-align:center }
  .dow { font-size:12px; color:var(--muted); padding:4px 0 }
  .d { height:42px; border:0; background:none; border-radius:50%; font-size:15px; color:var(--ink); margin:0; padding:0; width:100%; cursor:pointer }
  .d.off { color:#C8C8C8; text-decoration:line-through; cursor:default } .d.in { background:#F0F0F0; border-radius:0 }
  .d.edge { background:var(--ink); color:#fff } .d.empty { cursor:default }
  .guests { display:flex; gap:12px; margin-top:16px } .guests label { flex:1; font-size:13px; color:var(--muted) }
  select, input[type=text], input[type=email], input[type=tel] { width:100%; height:44px; padding:0 10px; border:1px solid #DDD; border-radius:8px; font-size:16px; background:#fff; color:var(--ink); margin-top:4px }
  .field { margin-top:12px; font-size:13px; color:var(--muted) } .two { display:flex; gap:12px } .two > * { flex:1 }
  .price { margin-top:16px; padding:12px; background:var(--bg); border-radius:10px } .hide { display:none }
  .terms { margin-top:12px; font-size:14px } .terms div { padding:8px 0; color:var(--muted) } .check { display:flex; gap:8px; align-items:center; margin-top:8px; font-size:14px }
  button[disabled] { opacity:.4 }
</style>
<div class="card">
  <h1>${esc(p.name)}</h1>
  <p class="muted">Book direct, below our Airbnb price · sleeps ${max} · check-in from ${esc(p.check_in_time || '15:00')}, check-out by ${esc(p.check_out_time || '10:00')}</p>
  <div class="cal">
    <div class="cal-head"><button type="button" id="prev" aria-label="Previous month">‹</button><b id="month"></b><button type="button" id="next" aria-label="Next month">›</button></div>
    <div class="grid" id="grid"></div>
    <p class="muted small" id="hint">Choose your check-in date.</p>
  </div>
  <div class="guests">
    <label>Adults<select id="adults">${options(1, max, Math.min(2, max))}</select></label>
    <label>Children<select id="children">${options(0, max - 1, 0)}</select></label>
  </div>
  <div class="price hide" id="price"></div>
  <form id="form" class="hide" autocomplete="on">
    <div class="two">
      <label class="field">First name<input type="text" id="first" name="given-name" autocomplete="given-name" required></label>
      <label class="field">Last name<input type="text" id="last" name="family-name" autocomplete="family-name"></label>
    </div>
    <label class="field">Email (for your receipt)<input type="email" id="email" autocomplete="email" required></label>
    <label class="field">Mobile<input type="tel" id="phone" autocomplete="tel"></label>
    ${terms}
    <button type="submit" id="pay">Pay</button>
    <p class="warn" id="error"></p>
    <p class="muted small">Card, Apple Pay or bank payment through Paystack. The full amount is paid now and your booking is confirmed straight away.</p>
  </form>
</div>
<script>
(function () {
  var slug = ${JSON.stringify(p.booking_slug)};
  var hasTerms = ${p.booking_terms ? 'true' : 'false'};
  var open = {}, minStay = {}, first = null, last = null, view = null, inDate = null, outDate = null, quote = null;
  var $ = function (id) { return document.getElementById(id); };
  var iso = function (d) { return d.toISOString().slice(0, 10); };
  var add = function (s, n) { return iso(new Date(Date.parse(s + 'T00:00:00Z') + n * 864e5)); };
  var rand = function (n) { return 'R' + Math.round(n).toLocaleString('en-ZA'); };
  var nice = function (s) { return new Date(s + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }); };
  function freeBetween(a, b) { for (var d = a; d < b; d = add(d, 1)) if (!open[d]) return false; return true; }
  function draw() {
    var y = view.getUTCFullYear(), m = view.getUTCMonth();
    $('month').textContent = view.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    var start = new Date(Date.UTC(y, m, 1)), lead = (start.getUTCDay() + 6) % 7, days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    var html = ['Mo','Tu','We','Th','Fr','Sa','Su'].map(function (d) { return '<div class="dow">' + d + '</div>'; }).join('');
    for (var i = 0; i < lead; i++) html += '<span class="d empty"></span>';
    for (var n = 1; n <= days; n++) {
      var d = iso(new Date(Date.UTC(y, m, n)));
      // A day can be a check-out when the night before it is free.
      // Before the check-in, a free day starts again from there.
      var can = inDate && !outDate ? ((d > inDate && freeBetween(inDate, d)) || (d < inDate && !!open[d])) : !!open[d];
      var cls = 'd' + (can ? '' : ' off') + ((d === inDate || d === outDate) ? ' edge' : (inDate && outDate && d > inDate && d < outDate ? ' in' : ''));
      html += '<button type="button" class="' + cls + '" data-d="' + d + '"' + (can ? '' : ' disabled') + '>' + n + '</button>';
    }
    $('grid').innerHTML = html;
    $('prev').disabled = iso(start) <= first.slice(0, 8) + '01';
    $('next').disabled = iso(new Date(Date.UTC(y, m + 1, 1))) > last;
  }
  function pick(d) {
    if (!inDate || outDate || d <= inDate) { inDate = d; outDate = null; quote = null; $('price').className = 'price hide'; $('form').className = 'hide';
      $('hint').textContent = 'Now choose your check-out date' + (minStay[d] ? ' (at least ' + minStay[d] + ' nights from this date).' : '.'); }
    else { outDate = d; $('hint').textContent = nice(inDate) + ' to ' + nice(outDate); price(); }
    draw();
  }
  function price() {
    var q = '?check_in=' + inDate + '&check_out=' + outDate + '&adults=' + $('adults').value + '&children=' + $('children').value;
    $('price').className = 'price'; $('price').textContent = 'Working out the price…';
    fetch('/book/' + slug + '/price' + q).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); }).then(function (res) {
      if (!res.ok) { $('price').innerHTML = '<span class="warn">' + (res.j.error || 'Not available') + '</span>'; $('form').className = 'hide'; return; }
      quote = res.j;
      if (!quote.bookable) { $('price').innerHTML = '<span class="warn">' + quote.reason + '</span>'; $('form').className = 'hide'; return; }
      $('price').innerHTML = '<div class="row" style="border:0"><span>' + quote.nights + ' night' + (quote.nights === 1 ? '' : 's') + ', cleaning included</span><b>' + rand(quote.total) + '</b></div>' +
        (quote.airbnb_total > quote.total ? '<div class="muted small">' + rand(quote.airbnb_total) + ' for the same stay on Airbnb</div>' : '');
      $('form').className = ''; $('pay').textContent = 'Pay ' + rand(quote.total);
    }).catch(function () { $('price').innerHTML = '<span class="warn">Could not get the price. Please try again.</span>'; });
  }
  $('grid').addEventListener('click', function (e) { var d = e.target.getAttribute && e.target.getAttribute('data-d'); if (d && !e.target.disabled) pick(d); });
  $('prev').onclick = function () { view = new Date(Date.UTC(view.getUTCFullYear(), view.getUTCMonth() - 1, 1)); draw(); };
  $('next').onclick = function () { view = new Date(Date.UTC(view.getUTCFullYear(), view.getUTCMonth() + 1, 1)); draw(); };
  $('adults').onchange = $('children').onchange = function () { if (inDate && outDate) price(); };
  $('form').onsubmit = function (e) {
    e.preventDefault(); $('error').textContent = '';
    if (hasTerms && !$('agreed').checked) { $('error').textContent = 'Please accept the booking terms.'; return; }
    $('pay').disabled = true; $('pay').textContent = 'Taking you to payment…';
    fetch('/book/' + slug + '/reserve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      check_in: inDate, check_out: outDate, adults: Number($('adults').value), children: Number($('children').value),
      first_name: $('first').value, last_name: $('last').value, email: $('email').value, phone: $('phone').value, agreed: hasTerms ? $('agreed').checked : true,
    }) }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); }).then(function (res) {
      if (res.ok && res.j.checkout_url) { window.location.href = res.j.checkout_url; return; }
      $('error').textContent = res.j.error || 'Could not start the payment.'; $('pay').disabled = false; $('pay').textContent = 'Pay ' + rand(quote.total);
    }).catch(function () { $('error').textContent = 'Could not start the payment. Please try again.'; $('pay').disabled = false; });
  };
  fetch('/book/' + slug + '/availability').then(function (r) { return r.json(); }).then(function (a) {
    (a.open || []).forEach(function (d) { open[d] = true; }); minStay = a.min_stay || {}; first = a.from; last = a.to;
    var start = a.open && a.open[0] ? a.open[0] : a.from;
    view = new Date(Date.UTC(+start.slice(0, 4), +start.slice(5, 7) - 1, 1)); draw();
  }).catch(function () { $('hint').textContent = 'Could not load the calendar. Please refresh the page.'; });
})();
</script>`));
  } catch (err) {
    console.error('book page:', err.message);
    res.status(500).send(page('Something went wrong', '<div class="card"><h1>Something went wrong</h1><p class="muted">Please try again in a moment.</p></div>'));
  }
});

router.get('/:slug/availability', async (req, res) => {
  try {
    const p = await site.bySlug(req.params.slug);
    if (!p) return res.status(404).json({ error: 'Not available' });
    res.json(await site.availability(p));
  } catch (err) { fail(res, err); }
});

router.get('/:slug/price', async (req, res) => {
  try {
    const p = await site.bySlug(req.params.slug);
    if (!p) return res.status(404).json({ error: 'Not available' });
    const { check_in, check_out, adults, children } = req.query;
    res.json(await site.price(p, { checkIn: String(check_in || ''), checkOut: String(check_out || ''), adults: Number(adults || 2), children: Number(children || 0) }));
  } catch (err) { fail(res, err); }
});

router.post('/:slug/reserve', reserveLimiter, async (req, res) => {
  try {
    const p = await site.bySlug(req.params.slug);
    if (!p) return res.status(404).json({ error: 'Not available' });
    const b = req.body || {};
    res.json(await site.reserve(p, {
      checkIn: String(b.check_in || ''), checkOut: String(b.check_out || ''), adults: b.adults, children: b.children,
      firstName: b.first_name, lastName: b.last_name, email: b.email, phone: b.phone, agreed: Boolean(b.agreed),
    }, baseUrl(req)));
  } catch (err) { fail(res, err); }
});

return router;
}

module.exports = { bookRouter };
