// v1780340380
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.map(c => caches.delete(c)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
self.addEventListener('push', e => {
  let title = '🌿 Bahçem';
  let body  = 'Sulama zamanı!';
  let url   = 'https://salimoglu.github.io/bahcem/';
  
  if (e.data) {
    try {
      const raw = e.data.text();
      console.log('[SW] Push raw:', raw);
      const d = JSON.parse(raw);
      console.log('[SW] Push parsed:', JSON.stringify(d));
      title = d.title || title;
      body  = d.body  || body;
      url   = d.url   || url;
    } catch(err) {
      console.log('[SW] Parse hatası:', err.message);
    }
  } else {
    console.log('[SW] e.data yok!');
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
