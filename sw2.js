// v1780339924
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.map(c => caches.delete(c)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
self.addEventListener('push', e => {
  let title = '🌿 Bahçem — Sulama Zamanı';
  let body  = 'Sulama bekleyen bitkileriniz var!';
  let url   = 'https://salimoglu.github.io/bahcem/';
  if (e.data) {
    try {
      const d = e.data.json();
      if (d.title) title = d.title;
      if (d.body)  body  = d.body;
      if (d.url)   url   = d.url;
      // webpush notification içinden de oku
      if (d.notification) {
        if (d.notification.title) title = d.notification.title;
        if (d.notification.body)  body  = d.notification.body;
      }
    } catch(err) {
      try { body = e.data.text(); } catch(e2) {}
    }
  }
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
