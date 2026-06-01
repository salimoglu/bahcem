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
  const title = payload.data?.title || payload.notification?.title || '🌿 Bahçem';
  const body  = payload.data?.body  || payload.notification?.body  || 'Sulama zamanı!';
  const url   = payload.data?.url   || 'https://salimoglu.github.io/bahcem/';

  return self.registration.showNotification(title, {
    body,
    icon:  '/bahcem/icons/icon-192.png',
    badge: '/bahcem/icons/icon-192.png',
    requireInteraction: true,
    data:  { url }
  });
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || 'https://salimoglu.github.io/bahcem/';
  e.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(list => {
    for (const c of list) if (c.url.includes('bahcem') && 'focus' in c) return c.focus();
    return clients.openWindow(url);
  }));
});
