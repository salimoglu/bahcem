// v20260531-fix-notif
const CACHE = 'bahcem-v20260531-fix';

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then(res => {
      const clone = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, clone));
      return res;
    }).catch(() => caches.match(e.request))
  );
});

self.addEventListener('push', e => {
  let title = '🌿 Bahçem — Sulama Zamanı';
  let body  = 'Sulama zamanı geldi!';

  if (e.data) {
    try {
      const d = e.data.json();
      if (d.title) title = d.title;
      if (d.body)  body  = d.body;
    } catch(err) {
      const text = e.data.text();
      if (text) body = text;
    }
  }

  e.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon:  '/bahcem/icons/icon-192.png',
      badge: '/bahcem/icons/icon-192.png',
      tag:   'bahcem-water',
      requireInteraction: true,
      data:  { url: 'https://salimoglu.github.io/bahcem/' }
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || 'https://salimoglu.github.io/bahcem/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (c.url === url && 'focus' in c) return c.focus();
      }
      return clients.openWindow(url);
    })
  );
});
