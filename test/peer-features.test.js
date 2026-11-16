const test = require('node:test');
const assert = require('node:assert/strict');
const { parseListing, roomsFrom } = require('../src/services/airbnb-listing');
const { FEATURES, has } = require('../src/services/peer-features');

/**
 * Reading what a listing offers off its public page, and matching it to
 * the features a guest chooses by. Pure: no network, no database.
 */

const feature = (name) => FEATURES.find(([n]) => n === name)[1];

test('room counts come from the sharing title, a studio included', () => {
  assert.deepEqual(roomsFrom('Cabin in Cape Town · ★4.97 · 2 bedrooms · 2 beds · 2 baths'), { bedrooms: 2, beds: 2, baths: 2 });
  assert.deepEqual(roomsFrom('Home in Neive · 7 bedrooms · 9 beds · 5.5 baths'), { bedrooms: 7, beds: 9, baths: 5.5 });
  assert.equal(roomsFrom('Studio in Scarborough · 1 bed · 1 bath').bedrooms, 0);
});

test('a page is read into amenities, ratings and size, unavailable amenities left out', () => {
  const page = { a: { sharingConfig: { title: 'Cabin in Cape Town · ★4.97 · 2 bedrooms · 2 beds · 2 baths' } },
    b: { sharingConfig: { propertyType: 'Entire cabin', personCapacity: 4, starRating: 4.97 } },
    c: { reviewCount: 117, isSuperhost: true, isGuestFavorite: true, mediaItems: [{}, {}, {}],
      categoryRatings: [{ categoryType: 'VALUE', localizedRating: '4.9' }, { categoryType: 'CLEANLINESS', localizedRating: '4.8' }],
      seeAllAmenitiesGroups: [{ title: 'Outdoor', amenities: [
        { available: true, title: 'Private hot tub - available all year' },
        { available: false, title: 'Unavailable: Pool' }] }] } };
  const l = parseListing(page);
  assert.equal(l.guests, 4);
  assert.equal(l.property_type, 'Entire cabin');
  assert.equal(l.rating, 4.97);
  assert.equal(l.reviews, 117);
  assert.equal(l.photos, 3);
  assert.deepEqual(l.category_ratings, { value: 4.9, cleanliness: 4.8 });
  assert.deepEqual(l.amenities, [{ group: 'Outdoor', title: 'Private hot tub - available all year' }]);
});

test("Airbnb's wording maps to the features guests choose by", () => {
  assert.ok(has(['Private outdoor pool - available all year, open 24 hours'], feature('Pool')));
  assert.ok(!has(['Pool table'], feature('Pool')), 'a pool table is not a pool');
  assert.ok(has(['Private hot tub - available all year'], feature('Hot tub')));
  assert.ok(has(['Bay view'], feature('Sea view')));
  assert.ok(has(['Beach access – Beachfront'], feature('Beachfront')));
  assert.ok(has(['Indoor fireplace'], feature('Fireplace')));
  assert.ok(has(['Private BBQ grill: gas'], feature('Braai / BBQ')));
});
