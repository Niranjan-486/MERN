// SmartQueue Service Worker (sw.js)
// Plain JavaScript - handles Web Push notifications and client window routing only.
// Does NOT cache app assets.

self.addEventListener('install', (event) => {
  // Activate immediately without waiting for existing tabs to close
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  // Claim all active clients immediately
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let payload = {};
  if (event.data) {
    try {
      payload = event.data.json();
    } catch (_) {
      try {
        payload = { body: event.data.text() };
      } catch (_) {
        payload = {};
      }
    }
  }

  const title = payload.title || 'Queue Update';
  const body = payload.body || 'You have an update on your queue status.';
  const tag = payload.tag || 'smartqueue-notification';
  const requireInteraction = Boolean(payload.requireInteraction);
  const url = payload.url || '/';

  const options = {
    body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag,
    renotify: true,
    requireInteraction,
    data: { url },
    vibrate: [200, 100, 200],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Focus existing window if one matches
      for (const client of clientList) {
        const matches = client.url === targetUrl || (targetUrl !== '/' && client.url && client.url.includes(targetUrl));
        if (matches && 'focus' in client) {
          return client.focus();
        }
      }
      // If there's an open window, focus it and navigate
      if (clientList.length > 0 && 'focus' in clientList[0]) {
        const client = clientList[0];
        if ('navigate' in client) {
          client.navigate(targetUrl);
        }
        return client.focus();
      }
      // Otherwise open a new window
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
