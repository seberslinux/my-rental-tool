/**
 * Detect currency from Smoobu booking data.
 * Parses the price-details field for currency codes.
 */

const SUPPORTED_CURRENCIES = /\b(EUR|ZAR|USD|GBP|CHF|AUD|NZD|SEK|NOK|DKK|CAD)\b/;

function detectCurrency(smoobuBooking) {
  const details = smoobuBooking['price-details'] || smoobuBooking.priceDetails || '';
  if (!details) return null;
  const match = details.match(SUPPORTED_CURRENCIES);
  return match ? match[1] : null;
}

module.exports = { detectCurrency };
