/* Service worker Kok Badminton.
 *
 * Target utamanya iOS standalone (app dari home screen):
 * 1. Aset build (`/_next/static/*`) cache-first → relaunch instan, gak nunggu
 *    network. Safari suka buang HTTP cache; Cache Storage jauh lebih awet.
 * 2. Navigasi network-first dengan fallback halaman `/offline`. Ini penting:
 *    di standalone gak ada address bar, jadi kalau network mati user kejebak
 *    di layar error Safari TANPA tombol reload. Fallback kita punya tombol
 *    "Coba lagi".
 *
 * Yang SENGAJA gak di-cache: `/api/*`, payload RSC (`?_rsc=`), dan HTML
 * halaman biasa — datanya realtime + ada rute admin, jadi jangan sampai
 * kesimpan/kesajikan basi.
 */

const VERSION = "v1";
const ASSET_CACHE = `kok-assets-${VERSION}`;
const SHELL_CACHE = `kok-shell-${VERSION}`;
const OFFLINE_URL = "/offline";
const KEEP = new Set([ASSET_CACHE, SHELL_CACHE]);

const ASSET_RE = /\.(?:js|css|woff2?|ttf|otf|png|jpe?g|gif|svg|webp|avif|ico)$/i;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // `reload` biar gak keambil dari HTTP cache yang mungkin sudah basi
      await cache.add(new Request(OFFLINE_URL, { cache: "reload" }));
      await self.skipWaiting();
    })().catch(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => !KEEP.has(k)).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

/** Aset build hashed → aman cache-first selamanya (nama file ganti tiap deploy). */
function isImmutableAsset(url) {
  return url.pathname.startsWith("/_next/static/");
}

/** Aset statis dari `public/` — cache-first tapi tetap direvalidasi di background. */
function isPublicAsset(url) {
  return (
    !url.pathname.startsWith("/_next/") &&
    !url.pathname.startsWith("/api/") &&
    ASSET_RE.test(url.pathname)
  );
}

async function cacheFirst(request) {
  const cache = await caches.open(ASSET_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok && res.type === "basic") cache.put(request, res.clone());
  return res;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(ASSET_CACHE);
  const hit = await cache.match(request);
  const network = fetch(request)
    .then((res) => {
      if (res.ok && res.type === "basic") cache.put(request, res.clone());
      return res;
    })
    .catch(() => hit);
  return hit || network;
}

async function navigate(request) {
  try {
    return await fetch(request);
  } catch {
    const cache = await caches.open(SHELL_CACHE);
    const fallback = await cache.match(OFFLINE_URL);
    if (fallback) return fallback;
    return new Response("Offline", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;

  // Data selalu langsung ke server: API, SSE, dan payload RSC navigasi client.
  if (url.pathname.startsWith("/api/")) return;
  if (url.searchParams.has("_rsc")) return;
  if (request.headers.get("RSC") === "1") return;

  if (request.mode === "navigate") {
    event.respondWith(navigate(request));
    return;
  }

  if (isImmutableAsset(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (isPublicAsset(url)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});
