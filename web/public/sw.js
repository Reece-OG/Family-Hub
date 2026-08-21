// Family Hub service worker.
//
// This is deliberately minimal. Family Hub is a fully dynamic app (all the
// interesting pages talk to /api/…), so we don't try to cache responses — we
// simply provide *some* service worker so Chrome / Safari treat the site as
// installable and let "Add to Home Screen" launch it in standalone mode.
//
// v5.0.5 — RSC-cache regression fix.
//
// v4.7.1's fetch strategy had a subtle catch-all bug: after handling HTML
// navigations, /_next/static/**, and /api/**, the "everything else same-origin"
// branch cached whatever it saw *cache-first*. That branch was intended for
// icons and the manifest, but in Next.js 14 App Router it also swallowed
// React Server Component payloads — the .rsc-style responses that
// router.refresh() and soft navigations fetch to update page data. Those
// requests have Accept: text/x-component (not text/html) and mode "cors"
// (not "navigate"), so they slipped past the isNavigation() gate and got
// pinned to the cache forever. Net effect: the dashboard's "Coming Up",
// stat counts, and other RSC-driven surfaces returned the first snapshot
// the SW ever saw, no matter how many times AutoRefresher fired. Users
// reported this as "the home screen has stale info", especially on iOS
// where the PWA was least likely to trigger a cache-invalidating hard
// navigation.
//
// New strategy:
//
//   • HTML navigations → always network, tiny offline fallback. (unchanged)
//   • Hashed Next.js build assets (/_next/static/**) → stale-while-revalidate.
//     Content-addressed filenames mean cache hits are always the right bytes.
//   • Explicit STATIC_SHELL entries (favicon, manifest) → cache-first with
//     runtime population. Narrow, safe.
//   • EVERYTHING ELSE → network-only, no SW interception at all. The browser
//     handles caching per its own HTTP headers, which for RSC payloads is
//     no-store. This is the change that fixes the staleness.
//   • POSTs and /api/** → never intercepted. (unchanged)
//
// CACHE_VERSION bump also wipes any previously-poisoned RSC entries from
// the old cache bucket during activate.

const CACHE_VERSION = "familyhub-shell-v4-5.0.7";
const STATIC_SHELL = [
  "/favicon.svg",
  "/manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(STATIC_SHELL).catch(() => undefined)),
  );
  // Take over the next page load immediately instead of waiting for every
  // open tab to close. Pairs with clients.claim() below + the client-side
  // controllerchange listener, which together eliminate the stale-SW window
  // that Chrome flags as "app out of date".
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Nuke any old cache buckets so a deploy never leaves stale files
      // around to be served by mistake.
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)),
      );
      await self.clients.claim();

      // Tell the freshly-claimed clients to reload — this is what makes the
      // "out of date" banner disappear on Android Chrome. Without the reload,
      // the page keeps running the previous bundle's JS even though the new
      // SW is live.
      const clients = await self.clients.matchAll({ type: "window" });
      for (const c of clients) {
        c.postMessage({ type: "FAMILYHUB_SW_UPDATED" });
      }
    })(),
  );
});

// Runtime helpers ------------------------------------------------------------

function isNavigation(req) {
  if (req.mode === "navigate") return true;
  const accept = req.headers.get("accept") || "";
  return accept.includes("text/html");
}

function isHashedStatic(url) {
  // Next.js emits content-hashed bundles under /_next/static/**. These never
  // change after a deploy (filenames include a hash), so caching forever is
  // both safe and a big win on cold launch.
  return url.pathname.startsWith("/_next/static/");
}

// v5.0.5 — explicit allow-list. Only entries whose pathname matches one of
// these get the cache-first treatment. Everything else falls through to
// network-only. Kept in sync with STATIC_SHELL so the addAll() in install
// and the runtime cache path agree on what belongs in the cache.
function isCacheableStaticShell(url) {
  return STATIC_SHELL.includes(url.pathname);
}

const OFFLINE_HTML =
  "<h1 style=\"font-family:system-ui;padding:24px\">You're offline</h1>" +
  "<p style=\"font-family:system-ui;padding:0 24px;color:#666\">Check your connection and pull to refresh.</p>";

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Only GETs are cacheable; POSTs etc. go straight to the network.
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Never intercept the API — always live data.
  if (url.pathname.startsWith("/api/")) return;

  // Cross-origin (CDN fonts, analytics, …) — let the browser handle it.
  if (url.origin !== self.location.origin) return;

  // 1. HTML navigations: always network, offline gets a tiny inline fallback.
  //    Crucially we do NOT cache HTML — that was the source of the stale
  //    shells that Chrome was flagging as out-of-date.
  if (isNavigation(req)) {
    event.respondWith(
      fetch(req).catch(
        () =>
          new Response(OFFLINE_HTML, {
            status: 503,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          }),
      ),
    );
    return;
  }

  // 2. Content-addressed Next.js bundles — stale-while-revalidate. Filename
  //    hashes mean a "hit" here is always the right bytes.
  if (isHashedStatic(url)) {
    event.respondWith(
      caches.open(CACHE_VERSION).then(async (cache) => {
        const hit = await cache.match(req);
        const network = fetch(req)
          .then((res) => {
            if (res && res.status === 200 && res.type === "basic") {
              cache.put(req, res.clone()).catch(() => undefined);
            }
            return res;
          })
          .catch(() => null);
        return hit || network || fetch(req);
      }),
    );
    return;
  }

  // 3. Explicit static shell (favicon, manifest) — cache-first with runtime
  //    population. Narrow allow-list, not a catch-all.
  if (isCacheableStaticShell(url)) {
    event.respondWith(
      caches.match(req).then((hit) => {
        if (hit) return hit;
        return fetch(req)
          .then((res) => {
            if (res && res.status === 200 && res.type === "basic") {
              const copy = res.clone();
              caches
                .open(CACHE_VERSION)
                .then((cache) => cache.put(req, copy))
                .catch(() => undefined);
            }
            return res;
          })
          .catch(
            () =>
              new Response("Offline", {
                status: 503,
                headers: { "Content-Type": "text/plain" },
              }),
          );
      }),
    );
    return;
  }

  // 4. Everything else (React Server Component payloads, image uploads,
  //    everything not explicitly whitelisted above) → network-only. We
  //    deliberately don't call event.respondWith here so the browser handles
  //    the request per its own HTTP caching semantics. This is what stops
  //    router.refresh()'s RSC fetches from being pinned to the SW cache.
});

// Allow the client to request an immediate skipWaiting — used by the
// "refresh now" affordance in ServiceWorkerRegister when a new SW is waiting.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "FAMILYHUB_SW_SKIP_WAITING") {
    self.skipWaiting();
  }
});

// ---------------------------------------------------------------------------
// v4.7.9 — Web Push
//
// The server (lib/push.ts → web-push) sends an encrypted payload to the
// browser's push service. The push service wakes us via a 'push' event
// even when the app isn't open. We turn the payload into a notification
// using the OS's native UI; clicking it focuses the app or opens the URL
// the server embedded.
// ---------------------------------------------------------------------------

self.addEventListener("push", (event) => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      // Some platforms wrap the payload as plain text; fall back gracefully.
      try {
        data = { title: "Family Hub", body: event.data.text() };
      } catch {
        data = { title: "Family Hub" };
      }
    }
  }
  const title = data.title || "Family Hub";
  const options = {
    body: data.body || "",
    icon: data.icon || "/favicon.svg",
    badge: data.badge || "/favicon.svg",
    tag: data.tag || undefined,
    // Replace prior notification with the same tag so a follow-up reminder
    // doesn't stack on top of the original.
    renotify: Boolean(data.tag),
    data: { url: data.url || "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      // If the app is already open in a tab, focus it (and try to navigate
      // it if the requested url differs).
      for (const c of all) {
        if ("focus" in c) {
          try {
            await c.focus();
            // Best-effort navigation; some browsers ignore navigate() in
            // service-worker contexts. Failure is non-fatal — focus is the
            // important bit.
            if (c.url !== targetUrl && "navigate" in c) {
              try {
                await c.navigate(targetUrl);
              } catch {
                /* swallow */
              }
            }
            return;
          } catch {
            /* fall through to openWindow */
          }
        }
      }
      if (self.clients.openWindow) {
        await self.clients.openWindow(targetUrl);
      }
    })(),
  );
});
