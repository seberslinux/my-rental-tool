/**
 * Apify Reviews Service
 * Fetches reviews from Airbnb and Booking.com listings via Apify actors.
 *
 * Required env: APIFY_API_TOKEN
 *
 * Actors used:
 *   Airbnb:     memo23/airbnb-scraper (free, includes reviews)
 *   Booking:    plowdata/booking-com-review-scraper (free)
 */

const axios = require('axios');
const { getOne, run } = require('../db/database');

const APIFY_BASE = 'https://api.apify.com/v2';

function getToken() {
  return process.env.APIFY_API_TOKEN;
}

/**
 * Run an Apify actor synchronously (waits up to 5 min) and return dataset items.
 */
async function runActorSync(actorId, input) {
  const token = getToken();
  if (!token) throw new Error('APIFY_API_TOKEN not set in .env');

  const runRes = await axios.post(
    `${APIFY_BASE}/acts/${actorId}/run-sync-get-dataset-items`,
    input,
    {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 300000,
      params: { format: 'json' },
    }
  );

  return runRes.data || [];
}

/**
 * Fetch Airbnb reviews for a listing URL.
 * Uses memo23/airbnb-scraper (free tier, returns listing with reviews array).
 */
async function fetchAirbnbReviews(listingUrl, maxReviews = 100) {
  // Clean URL to standard format
  const urlObj = new URL(listingUrl);
  const cleanUrl = `https://www.airbnb.com${urlObj.pathname}`;

  const input = {
    startUrls: [{ url: cleanUrl }],
    includeReviews: true,
    maxReviews: maxReviews,
  };

  const results = await runActorSync('memo23~airbnb-scraper', input);

  const reviews = [];
  for (const listing of results) {
    const listingReviews = listing.reviews || [];
    for (const r of listingReviews) {
      reviews.push({
        external_id: String(r.id || ''),
        guest_name: r.reviewer?.firstName || '',
        rating: r.rating || null,
        comment: r.comments || '',
        review_date: r.createdAt || '',
        response: typeof r.response === 'string' ? r.response : (r.response?.comments || ''),
        language: r.language || '',
        platform: 'Airbnb',
      });
    }
  }

  return reviews;
}

/**
 * Fetch Booking.com reviews for a hotel URL.
 * Uses plowdata/booking-com-review-scraper (free tier).
 * Requires a full Booking.com property URL (not a share link).
 */
async function fetchBookingReviews(hotelUrl, maxReviews = 100) {
  // Clean URL: strip query params to get base hotel URL
  const urlObj = new URL(hotelUrl);
  const cleanUrl = `${urlObj.origin}${urlObj.pathname}`;

  const results = await runActorSync('voyager~booking-reviews-scraper', {
    startUrls: [{ url: cleanUrl }],
    maxReviewsPerHotel: maxReviews,
  });

  const reviews = [];
  for (const r of results) {
    const liked = r.likedText || r.positive || r.liked || '';
    const disliked = r.dislikedText || r.negative || r.disliked || '';
    const comment = [liked ? `Liked: ${liked}` : '', disliked ? `Disliked: ${disliked}` : '']
      .filter(Boolean).join('\n') || r.reviewTitle || '';
    reviews.push({
      external_id: String(r.id || r.reviewId || ''),
      guest_name: r.userName || r.reviewerName || r.name || '',
      rating: r.rating || r.reviewScore || null,
      comment,
      review_date: r.reviewDate || r.checkOutDate || r.date || '',
      response: r.propertyResponse || r.hostResponse || r.managementResponse || '',
      language: r.reviewLanguage || r.userLocation || '',
      platform: 'Booking.com',
    });
  }

  return reviews;
}

/**
 * Sync reviews for a property. Fetches from Airbnb and/or Booking.com
 * based on the listing URLs configured for the property.
 */
async function syncReviewsForProperty(propertyId) {
  const property = await getOne('SELECT * FROM properties WHERE id = $1', [propertyId]);
  if (!property) throw new Error(`Property ${propertyId} not found`);

  let airbnbCount = 0;
  let bookingCount = 0;

  // Fetch Airbnb reviews
  if (property.airbnb_url) {
    try {
      const reviews = await fetchAirbnbReviews(property.airbnb_url);
      for (const r of reviews) {
        if (!r.external_id && !r.comment) continue;
        const extId = r.external_id || `airbnb_${r.review_date}_${r.guest_name}`;
        const date = normalizeDate(r.review_date);
        if (!date) continue;
        await run(
          `INSERT INTO reviews (property_id, platform, guest_name, rating, comment, review_date, response, external_id, language)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT(property_id, external_id) DO UPDATE SET
             rating = EXCLUDED.rating,
             comment = EXCLUDED.comment,
             response = EXCLUDED.response,
             language = EXCLUDED.language`,
          [propertyId, r.platform, r.guest_name, r.rating, r.comment, date, r.response || '', extId, r.language]
        );
        airbnbCount++;
      }
    } catch (err) {
      console.error(`Airbnb review fetch failed for ${property.name}:`, err.message);
    }
  }

  // Fetch Booking.com reviews
  if (property.booking_url) {
    try {
      const reviews = await fetchBookingReviews(property.booking_url);
      for (const r of reviews) {
        if (!r.external_id && !r.comment) continue;
        const extId = r.external_id || `booking_${r.review_date}_${r.guest_name}`;
        const date = normalizeDate(r.review_date);
        if (!date) continue;
        // Booking.com ratings are out of 10, normalize to out of 5
        const rating = r.rating ? Math.round((r.rating / 10) * 5 * 10) / 10 : null;
        await run(
          `INSERT INTO reviews (property_id, platform, guest_name, rating, comment, review_date, response, external_id, language)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT(property_id, external_id) DO UPDATE SET
             rating = EXCLUDED.rating,
             comment = EXCLUDED.comment,
             response = EXCLUDED.response,
             language = EXCLUDED.language`,
          [propertyId, r.platform, r.guest_name, rating, r.comment, date, r.response || '', extId, r.language]
        );
        bookingCount++;
      }
    } catch (err) {
      console.error(`Booking review fetch failed for ${property.name}:`, err.message);
    }
  }

  return { airbnb: airbnbCount, booking: bookingCount, total: airbnbCount + bookingCount };
}

/**
 * Normalize various date formats to YYYY-MM-DD
 */
function normalizeDate(dateStr) {
  if (!dateStr) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) return dateStr.substring(0, 10);
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  return null;
}

module.exports = {
  fetchAirbnbReviews,
  fetchBookingReviews,
  syncReviewsForProperty,
};
