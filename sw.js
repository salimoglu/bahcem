const CACHE = "bahcem-v1";
const BASE = self.location.pathname.replace(/\/?sw\.js$/i, "");
const ASSETS = [
  BASE + "/",
  BASE + "/index.html",
  BASE + "/bahcem.css",
  BASE + "/bahcem.js",
  BASE + "/manifest.json",
  BASE + "/icons/icon-192.png",
  BASE + "/icons/icon-512.png",
  BASE + "/icons/apple-touch-icon.png"
];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS).catch(() => {})));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (e) => {
  if (!e.request.url.startsWith(self.location.origin)) return;
  if (e.request.method !== "GET") return;

  const isDoc =
    e.request.mode === "navigate" ||
    e.request.destination === "document" ||
    ((e.request.headers.get("accept") || "").includes("text/html"));

  e.respondWith(
    fetch(e.request, { cache: "no-store" }).then((response) => {
      if (!isDoc && response && response.status === 200) {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(e.request, copy));
      }
      return response;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match(BASE + "/index.html")))
  );
});
