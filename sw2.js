// v1780340381 — FCM payload ayrıştırma
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.map(c => caches.delete(c)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});

function parsePushPayload(e) {
  const fallback = {
    title: '🌿 Bahçem',
    body:  'Sulama zamanı!',
    url:   'https://salimoglu.github.io/bahcem/'
  };
  if (!e.data) return fallback;
  try {
    const d = JSON.parse(e.data.text());
    const notif = d.notification || d.gcm?.notification || {};
    const data  = d.data || {};
    return {
      title: notif.title || data.title || d.title || fallback.title,
      body:  notif.body  || data.body  || d.body  || fallback.body,
      url:   data.url || d.url || d.fcmOptions?.link || fallback.url
    };
  } catch (err) {
    console.log('[SW] Parse hatası:', err.message);
    return fallback;
  }
}

self.addEventListener('push', e => {
  const { title, body, url } = parsePushPayload(e);
  console.log('[SW] Bildirim:', title, '|', body);

  e.waitUntil(self.registration.showNotification(title, {
    body,
    icon:  '/bahcem/icons/icon-192.png',
    badge: '/bahcem/icons/icon-192.png',
    requireInteraction: true,
    data:  { url }
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || 'https://salimoglu.github.io/bahcem/';
  e.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(list => {
    for (const c of list) if (c.url.includes('bahcem') && 'focus' in c) return c.focus();
    return clients.openWindow(url);
  }));
});
self.addEventListener('message', e => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});
