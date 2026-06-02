// v1780340382 — bildirim tıklayınca bahçeye git
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.map(c => caches.delete(c)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});

const APP_BASE = 'https://salimoglu.github.io/bahcem/';

function gardenFromUrl(url) {
  if (!url) return '';
  try {
    return new URL(url, APP_BASE).searchParams.get('garden') || '';
  } catch (_) {
    const m = String(url).match(/[?&]garden=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }
}

function parsePushPayload(e) {
  const fallback = {
    title: '🌿 Bahçem',
    body:  'Sulama zamanı!',
    url:   APP_BASE,
    gardenId: ''
  };
  if (!e.data) return fallback;
  try {
    const d = JSON.parse(e.data.text());
    const notif = d.notification || d.gcm?.notification || {};
    const data  = d.data || {};
    const url = data.url || d.url || d.fcmOptions?.link || fallback.url;
    return {
      title: notif.title || data.title || d.title || fallback.title,
      body:  notif.body  || data.body  || d.body  || fallback.body,
      url,
      gardenId: data.garden || data.gardenId || gardenFromUrl(url)
    };
  } catch (err) {
    console.log('[SW] Parse hatası:', err.message);
    return fallback;
  }
}

function openFromNotification(url, gardenId) {
  return clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) {
      if (!c.url.includes('bahcem')) continue;
      if (gardenId && c.postMessage) {
        c.postMessage({ type: 'open-garden', gardenId });
      }
      if ('focus' in c) return c.focus();
    }
    return clients.openWindow(url);
  });
}

self.addEventListener('push', e => {
  const { title, body, url, gardenId } = parsePushPayload(e);

  e.waitUntil(self.registration.showNotification(title, {
    body,
    icon:  '/bahcem/icons/icon-192.png',
    badge: '/bahcem/icons/icon-192.png',
    requireInteraction: true,
    data:  { url, gardenId }
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || APP_BASE;
  const gardenId = e.notification.data?.gardenId || gardenFromUrl(url);
  e.waitUntil(openFromNotification(url, gardenId));
});
self.addEventListener('message', e => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});
