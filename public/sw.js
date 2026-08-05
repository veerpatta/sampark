/**
 * Sampark service worker.
 *
 * One job: make the teacher's page open when there is no signal, so the draft
 * saved in localStorage has somewhere to render. It is deliberately small —
 * a service worker that caches too eagerly is how a school ends up staring at
 * yesterday's roster and not knowing why.
 *
 * Rules:
 *   - /r/* navigations: network first, fall back to the last good copy.
 *     Fresh beats cached, because the roster is the point.
 *   - /_next/static/*: cache first. Those URLs are content-hashed, so a hit is
 *     always correct and a miss just fetches.
 *   - everything else — the admin console, every API call: straight to the
 *     network, never cached. Stale student data is worse than no student data,
 *     and submissions must never be replayed from a cache.
 */
const VERSION = "sampark-v1";
const PAGES = `${VERSION}-pages`;
const ASSETS = `${VERSION}-assets`;

self.addEventListener("install", (event) => {
  // Take over as soon as the new worker is ready rather than waiting for every
  // tab to close — a teacher will not close her only tab for a week.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache anything under /api — least of all the teacher endpoints.
  if (url.pathname.startsWith("/api/")) return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request, ASSETS));
    return;
  }

  if (request.mode === "navigate" && url.pathname.startsWith("/r/")) {
    event.respondWith(networkFirst(request, PAGES));
  }
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;

  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    const hit = await cache.match(request);
    if (hit) return hit;
    throw error;
  }
}
