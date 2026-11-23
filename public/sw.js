/* Sentia service worker: offline fallback page + app-shell caching for the website / PWA.
 *
 * - Works under any base path (GitHub Pages "/Cursor-/" or the domain root): everything is
 *   resolved against this worker's own scope.
 * - Pages (navigations): network first, then the cached copy of that page, then offline.html.
 * - Hashed build files (/_next/static/…): cache first (their URL changes whenever they change).
 * - Other static files (icons, images, manifest): served from cache, refreshed in the background
 *   (stale-while-revalidate), so an updated icon or manifest is picked up on the next visit.
 * - NEVER cached: anything on another origin (the Sentia API: quotes, AI coach, feedback,
 *   usage counts), anything under /api/, non-GET requests, and RSC/data requests with a query.
 *   Those always go straight to the network.
 * - Not registered in the native (Capacitor) app, which already ships every file on the device.
 * - Notifications: price alerts / order fills shown by the page via registration.showNotification
 *   (works on Android and iOS home-screen apps); tapping one focuses or opens Sentia.
 * - Optional Web Push ("push" event) for background price alerts, only used when the Sentia API
 *   is deployed with VAPID keys and the site is built with NEXT_PUBLIC_VAPID_PUBLIC_KEY.
 */
const VERSION = "v3";
const SHELL_CACHE = `sentia-shell-${VERSION}`;
const ASSET_CACHE = `sentia-assets-${VERSION}`;
const SCOPE = new URL(self.registration ? self.registration.scope : "./", self.location.href);
const OFFLINE_URL = new URL("offline.html", SCOPE).href;
const SHELL_URLS = ["", "app/", "offline.html", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png"].map(
  (p) => new URL(p, SCOPE).href,
);

/**
 * Decide how to handle a request. Pure and exported for unit tests (src/lib/service-worker.test.ts).
 * @param {{ url: string, method: string, mode?: string, destination?: string }} req
 * @param {string} scope absolute scope URL, ending in "/"
 * @returns {"page" | "asset" | "bypass"}
 */
function classifyRequest(req, scope) {
  if (req.method !== "GET") return "bypass";
  let url;
  let base;
  try {
    url = new URL(req.url);
    base = new URL(scope);
  } catch {
    return "bypass";
  }
  if (url.origin !== base.origin) return "bypass"; // Sentia API, fonts CDN, GitHub…
  if (!url.pathname.startsWith(base.pathname)) return "bypass";
  const rel = url.pathname.slice(base.pathname.length);
  if (rel === "api" || rel.startsWith("api/")) return "bypass";
  if (rel === "sw.js") return "bypass";
  if (req.mode === "navigate") return "page";
  if (rel.startsWith("_next/static/")) return "asset";
  if (url.search) return "bypass"; // RSC payloads (?_rsc=…) and anything parameterised stay live
  if (/\.(?:png|jpe?g|webp|svg|ico|gif|woff2?|css|js|webmanifest)$/i.test(rel)) return "asset";
  return "bypass";
}

/**
 * Build the notification for a Web Push message. Pure and exported for unit tests.
 * Accepts {title, body, tag, url}; anything else falls back to a generic Sentia alert.
 * @param {unknown} data
 * @param {string} scope
 */
function pushNotice(data, scope) {
  const d = data && typeof data === "object" ? data : {};
  const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
  let url = new URL("app/", scope).href;
  try {
    const candidate = str(d.url, 300);
    if (candidate) {
      const u = new URL(candidate, scope);
      if (u.origin === new URL(scope).origin) url = u.href; // never open another site
    }
  } catch {
    // keep default
  }
  return {
    title: str(d.title, 80) || "Sentia price alert",
    options: {
      body: str(d.body, 200) || "One of your price alerts triggered.",
      tag: str(d.tag, 80) || "sentia-push",
      icon: new URL("icons/icon-192.png", scope).href,
      badge: new URL("icons/icon-192.png", scope).href,
      data: { url },
    },
  };
}

if (typeof module !== "undefined") module.exports = { classifyRequest, pushNotice };

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => Promise.all(SHELL_URLS.map((u) => cache.add(u).catch(() => undefined))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((n) => n.startsWith("sentia-") && n !== SHELL_CACHE && n !== ASSET_CACHE).map((n) => caches.delete(n))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const kind = classifyRequest({ url: req.url, method: req.method, mode: req.mode, destination: req.destination }, SCOPE.href);
  if (kind === "page") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && res.type === "basic") {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((c) => c.put(req, copy)).catch(() => undefined);
          }
          return res;
        })
        .catch(() =>
          caches
            .match(req, { ignoreSearch: true })
            .then((hit) => hit || caches.match(OFFLINE_URL))
            .then((hit) => hit || new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } })),
        ),
    );
  } else if (kind === "asset") {
    const hashed = new URL(req.url).pathname.includes("/_next/static/");
    const refresh = () =>
      fetch(req).then((res) => {
        if (res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(ASSET_CACHE).then((c) => c.put(req, copy)).catch(() => undefined);
        }
        return res;
      });
    event.respondWith(
      caches.match(req).then((hit) => {
        if (!hit) return refresh();
        if (!hashed) event.waitUntil(refresh().catch(() => undefined)); // stale-while-revalidate
        return hit;
      }),
    );
  }
  // "bypass": let the browser handle it (no respondWith) — never cached.
});

self.addEventListener("push", (event) => {
  let data = null;
  try {
    data = event.data ? event.data.json() : null;
  } catch {
    data = null;
  }
  const n = pushNotice(data, SCOPE.href);
  event.waitUntil(self.registration.showNotification(n.title, n.options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || new URL("app/", SCOPE).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.startsWith(SCOPE.href) && "focus" in client) {
          if ("navigate" in client) client.navigate(target).catch(() => undefined);
          return client.focus();
        }
      }
      return self.clients.openWindow ? self.clients.openWindow(target) : undefined;
    }),
  );
});
