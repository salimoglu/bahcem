// v20260531-force
const CACHE = "bahcem-v20260531";
self.addEventListener("install", e => { self.skipWaiting(); });
self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
  );
  self.clients.claim();
  // Tüm açık sekmeleri yenile
  self.clients.matchAll({type:"window"}).then(clients => {
    clients.forEach(c => c.navigate(c.url));
  });
});
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  // Cache kullanma, her zaman network'ten al
  e.respondWith(fetch(e.request));
});
