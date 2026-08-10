/**
 * What to do when the server says you are not signed in any more.
 *
 * Nothing did anything. Every panel fetched, checked `res.ok`, and on a
 * 401 quietly kept whatever empty state it started with — so an expired
 * session rendered a home screen reporting "Nothing needs you", no
 * bookings and no properties. A tick and a clean page, which is the
 * worst possible way to say "I could not read anything". The tab badge
 * still held the last real count and was the only honest thing on the
 * screen.
 *
 * A 401 is not data. It means sign in again, so it says so.
 */

let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

export class Unauthorized extends Error {}

/**
 * GET some JSON, or throw. Callers that want to render a failure state
 * catch; a 401 never reaches them, because there is exactly one right
 * response to it and it is not each panel's to decide.
 */
export async function apiGet<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (res.status === 401) {
    if (onUnauthorized) onUnauthorized();
    throw new Unauthorized('signed out');
  }
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}
