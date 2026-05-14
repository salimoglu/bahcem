// =============================================
// BAHÇEM Service Worker — FCM Push Bildirimleri
// =============================================
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyBp2bOuZIdTNk6j6CtJ2jb5beyCXife8s4",
  authDomain: "bahcem-app-eceb9.firebaseapp.com",
  projectId: "bahcem-app-eceb9",
  storageBucket: "bahcem-app-eceb9.firebasestorage.app",
  messagingSenderId: "251572935217",
  appId: "1:251572935217:web:41ee9cf20136d6404cd310"
});

const messaging = firebase.messaging();

// Uygulama KAPALI/ARKA PLANDA iken gelen push
messaging.onBackgroundMessage(payload => {
  const { title, body } = payload.notification || {};
  return self.registration.showNotification(title || "Bahçem", {
    body: body || "Sulama zamanı!",
    icon: "/bahcem/icons/icon-192.png",
    badge: "/bahcem/icons/icon-192.png",
    tag: "bahcem-water",
    requireInteraction: true,
    data: { url: "https://salimoglu.github.io/bahcem/" }
  });
});

// Bildirime tıklanınca uygulamayı aç
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "https://salimoglu.github.io/bahcem/";
  e.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (c.url === url && "focus" in c) return c.focus();
      }
      return clients.openWindow(url);
    })
  );
});

// Cache
const CACHE = "bahcem-v20260516";
self.addEventListener("install",  () => self.skipWaiting());
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
