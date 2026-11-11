/**
 * The competitor set, as chosen with the owner on 2026-11-11.
 *
 * The first twenty are str-tracker's curated small-homes list, which is
 * also the peer set of the "properties vs peers" analysis; the last six
 * were picked by hand from the Airbnb map around Hill Top Street.
 *
 * `property` names the property a listing is compared with, matched by
 * name because the property rows come from Smoobu and their ids are not
 * known when this runs. `own` marks our own Airbnb listings, which are
 * read the same way so the comparison is like for like: a night is
 * "sold" when Airbnb says it is not open, for us and for them.
 *
 * Shamayim Katan is "Tal's house" — the host is listed as Tahl — and is
 * the benchmark for the Lodge: same size, 300 m away, the best performer
 * in the segment.
 */
const LODGE = 'Hill Top Lodge';
const LOFT = 'The loft';

module.exports = [
  { id: '46742610', name: 'Scarborough Loft', bedrooms: 1, property: LOFT, own: true },
  { id: '1323840169081237366', name: 'The Hill Top Lodge', bedrooms: 2, property: LODGE, own: true },

  { id: '1273593055077595534', name: "Shamayim Katan (Tal's house)", bedrooms: 2, property: LODGE, benchmark: true },
  { id: '1533995602161697599', name: 'Stylish Seaside Home with Courtyard Shower', bedrooms: 2, property: LODGE },
  { id: '1558113889566842276', name: 'Kabelane Coastal Retreat', bedrooms: 2, property: LODGE },
  { id: '1572404634636934134', name: 'Casa di Scarborough al Mare', bedrooms: 2, property: LODGE },
  { id: '1264394007808049482', name: 'Peaceful Scarborough Family Beach House', bedrooms: 2, property: LODGE },
  { id: '11541476', name: 'Exclusive Tree House Hideaway', bedrooms: 2, property: LODGE },
  { id: '1485303984792321678', name: "Home in Simon's Town, indoor fireplace", bedrooms: 2, property: LODGE },
  { id: '1243182164097976342', name: 'Oliver House, Scarborough', bedrooms: 2, property: LODGE },
  { id: '1190399140471593049', name: 'Our Cozy Scarbs Cottage', bedrooms: 2, property: LODGE },
  { id: '8496523', name: 'Scarborough Beach cottage', bedrooms: 2, property: LODGE },
  { id: '40002835', name: 'Ballygale 547 Family Beach Cottage', bedrooms: 2, property: LODGE },
  { id: '14956791', name: 'Sea Song', bedrooms: 2, property: LODGE },
  { id: '760006842686007779', name: 'Seaforest', bedrooms: 2, property: LODGE },
  { id: '7959457', name: "Fisherman's Cottage", bedrooms: 2, property: LODGE },
  { id: '54195155', name: 'Ocean Level at Hilltop House', bedrooms: 2, property: LODGE },

  { id: '894078164123753275', name: 'Dream View Studio', bedrooms: 1, property: LOFT },
  { id: '53454133', name: 'Beyond Misty Cliffs Seaview Studio', bedrooms: 1, property: LOFT },
  { id: '1147750325888719207', name: 'Nightjar Cottage', bedrooms: 1, property: LOFT },
  { id: '1268135086577168975', name: 'Rooibokkie Studio', bedrooms: 1, property: LOFT },
  { id: '1092601931323926869', name: "Life's A Beach", bedrooms: 1, property: LOFT },
  { id: '612180643475061989', name: 'Red Rock Cottage', bedrooms: 1, property: LOFT },
  { id: '28045198', name: 'Sea Sea Me', bedrooms: 1, property: LOFT },
  { id: '46868791', name: 'The Breathing Space', bedrooms: 1, property: LOFT },
  { id: '22855772', name: 'Scarborough Otters Den', bedrooms: 1, property: LOFT },
];
