import { supabase } from './supabase'

/**
 * Web push subscription management (V2-6).
 *
 * Android and desktop only. iOS was dropped in Q8, and its web push needs the
 * app installed to the home screen before it will subscribe at all — support()
 * simply reports false where the APIs are missing rather than special-casing
 * any platform.
 *
 * Subscriptions live outside the sync engine on purpose. One belongs to a
 * single browser on a single device, not to the user's data; mirroring them
 * would leave every device holding endpoints it must never send to. Subscribing
 * needs the network regardless, so an outbox would buy nothing.
 */

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

export type PushSupport =
  | { ok: true }
  | { ok: false; reason: string }

export function support(): PushSupport {
  if (!('serviceWorker' in navigator)) return { ok: false, reason: 'This browser has no service worker support.' }
  if (!('PushManager' in window)) return { ok: false, reason: 'This browser cannot receive push notifications.' }
  if (!('Notification' in window)) return { ok: false, reason: 'This browser cannot show notifications.' }
  if (!VAPID_PUBLIC_KEY) return { ok: false, reason: 'Push is not configured for this deployment.' }
  return { ok: true }
}

/**
 * The VAPID key travels as base64url but `applicationServerKey` wants bytes.
 * Padding and the URL-safe alphabet both have to be undone first.
 */
function toUint8Array(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = base64url.padEnd(base64url.length + (4 - base64url.length % 4) % 4, '=')
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

/** The keys a push service needs, pulled out of the browser's subscription. */
function keysOf(sub: PushSubscription) {
  const json = sub.toJSON()
  const keys = json.keys ?? {}
  if (!keys.p256dh || !keys.auth) throw new Error('The browser returned a subscription with no keys.')
  return { p256dh: keys.p256dh, auth: keys.auth }
}

export class PushError extends Error {}

/**
 * Ask for permission, subscribe, and register the endpoint.
 *
 * Permission is requested here rather than on load. A notification prompt that
 * appears before the user has asked for notifications is the fastest way to get
 * permanently denied, and `denied` cannot be undone from script.
 */
export async function enablePush(userId: string): Promise<void> {
  const s = support()
  if (!s.ok) throw new PushError(s.reason)

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new PushError(
      permission === 'denied'
        ? 'Notifications are blocked for this site. Allow them in your browser settings, then try again.'
        : 'Notifications were not allowed.',
    )
  }

  const registration = await navigator.serviceWorker.ready

  // An existing subscription is reused. Calling subscribe() again with the same
  // key returns the same endpoint, but reusing it avoids the failure when a
  // *different* key was used before.
  const existing = await registration.pushManager.getSubscription()
  const sub = existing ?? await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: toUint8Array(VAPID_PUBLIC_KEY!),
  })

  const { p256dh, auth } = keysOf(sub)
  const { error } = await supabase.from('push_subscriptions').upsert({
    endpoint: sub.endpoint,
    user_id: userId,
    p256dh,
    auth,
    user_agent: navigator.userAgent.slice(0, 300),
    failed_at: null,        // a re-subscribe revives an endpoint we had retired
  }, { onConflict: 'endpoint' })

  if (error) throw new PushError(`Could not register for reminders: ${error.message}`)
}

/**
 * Unsubscribe this device.
 *
 * The row is removed rather than tombstoned: push_subscriptions is device state
 * outside the sync engine, so there is no offline replica to inform (ADR 0002's
 * reasoning does not reach here).
 */
export async function disablePush(): Promise<void> {
  if (!('serviceWorker' in navigator)) return
  const registration = await navigator.serviceWorker.ready
  const sub = await registration.pushManager.getSubscription()
  if (!sub) return

  await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
  await sub.unsubscribe()
}

/** Whether this browser currently holds a subscription. */
export async function isSubscribed(): Promise<boolean> {
  if (!('serviceWorker' in navigator)) return false
  try {
    const registration = await navigator.serviceWorker.ready
    return (await registration.pushManager.getSubscription()) !== null
  } catch {
    return false
  }
}
