const CACHE_NAME = "histo-revise-v4";
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./atlas.js",
  "./atlas-3d.html",
  "./config.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      // « reload » : on ignore le cache HTTP du navigateur pour installer des fichiers VRAIMENT à jour
      .then((cache) => Promise.all(ASSETS.map((u) => fetch(new Request(u, { cache: "reload" })).then((r) => { if (!r.ok) throw new Error("HTTP " + r.status + " " + u); return cache.put(u, r); }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Ne jamais mettre en cache les appels Supabase : seulement l'app shell locale.
  if (url.origin !== location.origin || event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request.url, { cache: "no-cache" })
        .then((response) => {
          if (response && response.ok) { const copy = response.clone(); caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)); }
          return response;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
