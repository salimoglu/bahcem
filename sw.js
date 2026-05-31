// v1780253724
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.map(c => caches.delete(c)))).then(() => self.clients.claim()));
});

// Cache kullanma - her zaman network
self.addEventListener('fetch', e => {
  e.respondWith(fetch(e.request).catch(() => new Response('Offline')));
});

// Push bildirimi
self.addEventListener('push', e => {
  let title = '🌿 Bahçem';
  let body  = 'Sulama zamanı!';
  let url   = 'https://salimoglu.github.io/bahcem/';
  try {
    const d = e.data.json();
    if (d.title) title = d.title;
    if (d.body)  body  = d.body;
    if (d.url)   url   = d.url;
  } catch(e) {}
  e.waitUntil(self.registration.showNotification(title, {
    body, icon: '/bahcem/icons/icon-192.png',
    badge: '/bahcem/icons/icon-192.png',
    tag: 'bahcem-water', requireInteraction: true,
    data: { url }
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
