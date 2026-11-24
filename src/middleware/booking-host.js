/**
 * The booking address (PUBLIC_BASE_URL, e.g. https://book.scarboroughgetaways.com)
 * is the guests' side only: the booking pages, the payment pages and
 * Paystack's webhook. The app — sign-in, the dashboard, its API — is not
 * served there; it stays on its own address (APP_URL).
 *
 * The bare booking address goes to the website (WEBSITE_URL) when one is
 * set. Anything else there is not found.
 */

const GUEST_PATHS = ['/book/', '/pay/', '/paystack/webhook'];

const hostOf = (url) => {
  try { return url ? new URL(url).hostname.toLowerCase() : null; } catch { return null; }
};

/** Where guests are sent: the booking address, or null when there is none. */
const bookingBaseUrl = () => (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '') || null;

function bookingHost() {
  return (req, res, next) => {
    const host = hostOf(process.env.PUBLIC_BASE_URL);
    // No booking address, or it is the app's own: nothing to keep apart.
    if (!host || host === hostOf(process.env.APP_URL) || req.hostname.toLowerCase() !== host) return next();
    if (GUEST_PATHS.some((p) => req.path.startsWith(p))) return next();
    if (req.path === '/' && process.env.WEBSITE_URL) return res.redirect(302, process.env.WEBSITE_URL);
    res.status(404).type('text').send('Not found');
  };
}

module.exports = { bookingHost, bookingBaseUrl };
