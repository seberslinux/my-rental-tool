/**
 * Turning on notifications.
 *
 * iOS grants permission only from a real tap, and only to an app that is
 * already on the Home Screen — so this can never run on load, and it has
 * to be able to explain why it is unavailable rather than fail quietly.
 * Everything here reports a reason.
 */

import { isInstalled } from '../components/AddToHomeScreen';

export type PushState =
'ready' |            // subscribed, notifications will arrive
'can-ask' |          // supported and permitted to ask
'needs-install' |    // iPhone, in Safari, not yet on the Home Screen
'denied' |           // the browser was told no; only settings can undo it
'unsupported' |      // no service worker or no Push API
'not-configured';    // the server has no VAPID keys

const isIOS = () =>
/iPad|iPhone|iPod/.test(navigator.userAgent) ||
(navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1);

/** Base64url from the server to the Uint8Array the Push API wants. */
function toKey(base64: string): BufferSource {
  const padded = (base64 + '='.repeat((4 - base64.length % 4) % 4)).
  replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  // .buffer, because the Push API types want a BufferSource and a
  // typed array over a generic ArrayBufferLike no longer satisfies it.
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0))).buffer;
}

export async function pushState(): Promise<PushState> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    // iOS before 16.4, or a browser without push. On an iPhone the usual
    // cause is simply not being installed yet, which is fixable.
    return isIOS() && !isInstalled() ? 'needs-install' : 'unsupported';
  }
  if (isIOS() && !isInstalled()) return 'needs-install';
  if (Notification.permission === 'denied') return 'denied';

  const res = await fetch('/api/push/key', { credentials: 'same-origin' });
  const { configured } = res.ok ? await res.json() : { configured: false };
  if (!configured) return 'not-configured';

  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  return existing ? 'ready' : 'can-ask';
}

/**
 * Ask, subscribe, and tell the server. Must be called from a click.
 *
 * Returns the resulting state rather than a boolean, so the caller can
 * say what happened instead of just that it did not work.
 */
export async function enablePush(): Promise<PushState> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'can-ask';

  const res = await fetch('/api/push/key', { credentials: 'same-origin' });
  const { key, configured } = await res.json();
  if (!configured || !key) return 'not-configured';

  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: toKey(key),
  });

  const saved = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(sub),
  });
  if (!saved.ok) return 'can-ask';

  return 'ready';
}

export async function disablePush(): Promise<void> {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  await fetch('/api/push/subscribe', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ endpoint: sub.endpoint }),
  });
  await sub.unsubscribe();
}

/** Prove it reaches this handset, which is the only convincing test. */
export async function sendTestPush(): Promise<boolean> {
  const res = await fetch('/api/push/test', { method: 'POST', credentials: 'same-origin' });
  if (!res.ok) return false;
  const { sent } = await res.json();
  return sent > 0;
}
