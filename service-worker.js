const CACHE_NAME = "finanzas-compartidas-v24";
const APP_SHELL = [
  "./",
  "./index.html",
  "./register.html",
  "./movement.html",
  "./history.html",
  "./income-history.html",
  "./credit-history.html",
  "./category.html",
  "./payments.html",
  "./payment-cycle.html",
  "./adjustments.html",
  "./styles.css",
  "./app-v24.js",
  "./manifest.webmanifest",
  "./bac-credomatic.png",
  "./colones-cr.png",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(key => key === CACHE_NAME ? Promise.resolve() : caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", event => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  const coreFile =
    event.request.mode === "navigate" ||
    /\.(?:html|js|css|webmanifest)$/.test(url.pathname);

  if (coreFile) {
    event.respondWith(
      fetch(event.request, { cache: "no-store" })
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request).then(cached => cached || caches.match("./index.html")))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});
