/* Push handling, layered onto the Workbox service worker via importScripts.
 *
 * Kept as a plain file in public/ rather than switching the PWA plugin to
 * injectManifest: that mode hands over authorship of the whole service worker,
 * and the offline shell it already generates is working and verified. This adds
 * two listeners and touches nothing else.
 */

self.addEventListener('push', event => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch (e) {
    // A push with an unreadable body still deserves to surface: the browser
    // requires a visible notification for every push it delivers, and staying
    // silent here shows the user a "this site was updated in the background"
    // notice instead of ours.
  }

  const title = payload.title || 'Habit Tracker'
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || 'Anything left for today?',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: 'daily-reminder',        // one at a time; a new one replaces the old
      renotify: false,
      data: { url: payload.url || '/' },
    }),
  )
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.url) || '/'

  // Focus the app if it is already open rather than opening a second copy.
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) return client.focus()
      }
      return self.clients.openWindow(target)
    }),
  )
})
