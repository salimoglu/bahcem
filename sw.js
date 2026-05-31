// v20260531c
const CACHE = 'bahcem-v20260531c';

self.addEventListener('install', e => {
  self.skipWaiting(); // Hemen aktif ol, bekleme
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim()) // Tüm sekmeleri hemen ele geçir
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // Network first — her zaman en güncel versiyon
  e.respondWith(
    fetch(e.request).then(res => {
      // Başarılı response'u cache'e yaz
      const clone = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, clone));
      return res;
    }).catch(() => caches.match(e.request)) // Offline'da cache'den
  );
});

// Push bildirimleri
self.addEventListener('push', e => {
  const data = e.data ? e.data.json() : {};
  e.waitUntil(
    self.registration.showNotification(data.title || 'Bahçem', {
      body: data.body || 'Sulama zamanı!',
      icon: '/bahcem/icons/icon-192.png',
      badge: '/bahcem/icons/icon-192.png',
      tag: 'bahcem-water',
      requireInteraction: true,
      data: { url: 'https://salimoglu.github.io/bahcem/' }
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
