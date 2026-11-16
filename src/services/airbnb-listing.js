/**
 * A listing as its public Airbnb page describes it: what it has, how it is
 * rated, how big it is.
 *
 * Read logged out from the page's embedded data, the same page a guest
 * opens. Taken weekly for every tracked listing, it is the half of the
 * record that says what a place offers, beside the calendars and prices
 * that say how it sells — together, which features earn.
 */

const BASE = 'https://www.airbnb.co.za';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

/** The first value under each wanted key, anywhere in the page data. */
function collect(data, keys) {
  const found = {};
  (function walk(o) {
    if (!o || typeof o !== 'object') return;
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (keys.includes(k) && found[k] === undefined && v != null) found[k] = v;
      walk(v);
    }
  })(data);
  return found;
}

/** "Cabin in Cape Town · ★4.97 · 2 bedrooms · 2 beds · 2 baths" */
function roomsFrom(title) {
  const n = (re) => { const m = String(title || '').match(re); return m ? Number(m[1]) : null; };
  return {
    bedrooms: /\bstudio\b/i.test(title || '') ? 0 : n(/(\d+)\s+bedrooms?/i),
    beds: n(/(\d+)\s+beds?\b/i),
    baths: n(/([\d.]+)\s+(?:shared\s+|private\s+)?(?:baths?|bathrooms?)/i),
  };
}

/** Parse the page's embedded data into the snapshot's fields. */
function parseListing(data) {
  const f = collect(data, [
    'sharingConfig', 'reviewCount', 'isSuperhost', 'isGuestFavorite', 'categoryRatings',
    'seeAllAmenitiesGroups', 'mediaItems', 'guestSatisfactionOverall',
  ]);
  // The page carries several sharing blocks, each with some of the
  // fields; together they have the title, type, capacity and stars.
  const share = {};
  (function walk(o) {
    if (!o || typeof o !== 'object') return;
    for (const k of Object.keys(o)) {
      if (k === 'sharingConfig' && o[k] && typeof o[k] === 'object') {
        for (const [kk, vv] of Object.entries(o[k])) if (vv != null && share[kk] == null) share[kk] = vv;
      }
      walk(o[k]);
    }
  })(data);
  const amenities = [];
  for (const group of Array.isArray(f.seeAllAmenitiesGroups) ? f.seeAllAmenitiesGroups : []) {
    for (const a of group.amenities || []) {
      if (a && a.available && a.title) amenities.push({ group: group.title || null, title: a.title });
    }
  }
  const ratings = {};
  for (const r of Array.isArray(f.categoryRatings) ? f.categoryRatings : []) {
    const v = Number(r.localizedRating);
    if (r.categoryType && Number.isFinite(v)) ratings[r.categoryType.toLowerCase()] = v;
  }
  const rating = Number(share.starRating ?? f.guestSatisfactionOverall);
  return {
    title: share.title || null,
    property_type: share.propertyType || null,
    rating: Number.isFinite(rating) && rating > 0 ? rating : null,
    reviews: Number.isFinite(Number(f.reviewCount)) ? Number(f.reviewCount) : null,
    guests: Number.isFinite(Number(share.personCapacity)) ? Number(share.personCapacity) : null,
    ...roomsFrom(share.title),
    superhost: typeof f.isSuperhost === 'boolean' ? f.isSuperhost : null,
    guest_favorite: f.isGuestFavorite === true || f.isGuestFavorite === 'true',
    photos: Array.isArray(f.mediaItems) ? f.mediaItems.length : null,
    category_ratings: ratings,
    amenities,
  };
}

async function fetchListing(listingId, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`${BASE}/rooms/${listingId}`, { headers: { 'User-Agent': UA, 'Accept-Language': 'en' } });
  if (!res.ok) throw new Error(`Airbnb listing page answered ${res.status}`);
  const html = await res.text();
  const m = html.match(/<script id="data-deferred-state-0"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('No listing data on the page — the page layout has changed');
  const parsed = parseListing(JSON.parse(m[1]));
  if (!parsed.amenities.length && parsed.reviews == null) throw new Error('The listing page carried no details');
  return parsed;
}

module.exports = { fetchListing, parseListing, roomsFrom };
