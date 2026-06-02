importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyBp2bOuZIdTNk6j6CtJ2jb5beyCXife8s4",
  authDomain: "bahcem-app-eceb9.firebaseapp.com",
  projectId: "bahcem-app-eceb9",
  storageBucket: "bahcem-app-eceb9.firebasestorage.app",
  messagingSenderId: "251572935217",
  appId: "1:251572935217:web:41ee9cf20136d6404cd310"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(payload => {
  const notif = payload.notification || {};
  const data  = payload.data || {};
  const title = data.title || notif.title || '🌿 Bahçem';
  const body  = data.body  || notif.body  || 'Sulama zamanı!';
  const url   = data.url   || 'https://salimoglu.github.io/bahcem/';
  const gardenId = data.garden || data.gardenId || '';

  return self.registration.showNotification(title, {
    body,
    icon:  '/bahcem/icons/icon-192.png',
    badge: '/bahcem/icons/icon-192.png',
    requireInteraction: true,
    data:  { url, gardenId }
  });
});

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

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || 'https://salimoglu.github.io/bahcem/';
  const gardenId = e.notification.data?.gardenId || '';
  e.waitUntil(openFromNotification(url, gardenId));
});
