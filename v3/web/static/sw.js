// Service worker — offline read + ajakan pembaruan versi (PLAN.md §14 F5,
// §11 "mode pesawat tetap bisa dibaca"). Precache app-shell minimal +
// offline.html; runtime cache aset statis (cache-first) dan navigasi
// (network-first, fallback ke shell cache lalu ke offline.html).
//
// /api/* TIDAK disentuh sama sekali — outbox.ts (IndexedDB, F5/1) yang
// pegang keandalan tulis-offline & antrean; service worker cuma tanggung
// jawab "halaman kebaca offline", bukan data.
//
// CACHE_VERSION naik manual tiap kali strategi cache di file ini berubah —
// bukan per-deploy (aset SvelteKit sudah self-busting lewat nama file
// ber-hash, jadi tidak perlu daftar manifest build di sini).
const CACHE_VERSION = 'kok-v1';
const OFFLINE_URL = '/offline.html';
const APP_SHELL = ['/', OFFLINE_URL, '/favicon.svg'];

self.addEventListener('install', (event) => {
	event.waitUntil(caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL)));
	// SENGAJA tidak skipWaiting() di sini — worker baru nunggu sampai user
	// setuju lewat tombol "Muat ulang" (lihat lib/offline/sw.ts notifyUpdate).
	// Auto-activate di sini bikin tab lama patah diam-diam pas versi baru
	// keluar, itu yang mau dihindari.
});

self.addEventListener('message', (event) => {
	if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
			.then(() => self.clients.claim())
	);
});

self.addEventListener('fetch', (event) => {
	const req = event.request;
	const url = new URL(req.url);

	// Cuma tangani GET same-origin. API, POST/PUT/dst, dan cross-origin
	// (font Google) lewat langsung tanpa campur tangan SW.
	if (req.method !== 'GET' || url.origin !== self.location.origin) return;
	if (url.pathname.startsWith('/api/')) return;

	if (req.mode === 'navigate') {
		event.respondWith(networkFirstNavigate(req));
		return;
	}

	event.respondWith(cacheFirstAsset(req));
});

// SPA statis (adapter-static, fallback index.html) — semua rute jatuh ke
// shell yang sama, jadi cukup simpan satu salinan '/' dan pakai itu untuk
// path apa pun saat offline. Router client (SvelteKit) baca location.pathname
// sendiri begitu hydrate, jadi URL asli tetap kepegang browser.
async function networkFirstNavigate(req) {
	try {
		const res = await fetch(req);
		const cache = await caches.open(CACHE_VERSION);
		cache.put('/', res.clone());
		return res;
	} catch {
		const cache = await caches.open(CACHE_VERSION);
		return (await cache.match('/')) || (await cache.match(OFFLINE_URL)) || Response.error();
	}
}

// Aset statis (JS/CSS/font/gambar) — cache-first supaya instan, tapi tetap
// disegarkan diam-diam di background (stale-while-revalidate ringan) biar
// tidak selamanya nyangkut di versi lama kalau nama file tidak berubah.
async function cacheFirstAsset(req) {
	const cache = await caches.open(CACHE_VERSION);
	const cached = await cache.match(req);
	if (cached) {
		revalidateInBackground(req, cache);
		return cached;
	}
	try {
		const res = await fetch(req);
		if (res.ok) cache.put(req, res.clone());
		return res;
	} catch {
		return Response.error();
	}
}

function revalidateInBackground(req, cache) {
	fetch(req)
		.then((res) => {
			if (res.ok) cache.put(req, res);
		})
		.catch(() => {});
}

// Web Push (PLAN.md §10.2, §14 F8) — payload dikirim server persis bentuk
// notify.notifPayload Go ({title, body, url}), lihat internal/notify/router.go.
self.addEventListener('push', (event) => {
	let data = { title: 'Kok Badminton', body: 'Ada kabar baru.' };
	try {
		if (event.data) data = { ...data, ...event.data.json() };
	} catch {
		// payload bukan JSON (seharusnya tidak pernah terjadi, server selalu
		// kirim JSON) — tampilkan judul bawaan daripada gagal diam-diam.
	}
	event.waitUntil(
		self.registration.showNotification(data.title, {
			body: data.body,
			icon: '/favicon.svg',
			data: { url: data.url || '/' }
		})
	);
});

// Klik notifikasi → fokus tab yang sudah terbuka kalau ada, atau buka baru
// ke URL deep-link yang dikirim server (mis. "/main", "/klub").
self.addEventListener('notificationclick', (event) => {
	event.notification.close();
	const url = event.notification.data?.url || '/';
	event.waitUntil(
		self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
			for (const client of clients) {
				if ('focus' in client) {
					client.navigate(url);
					return client.focus();
				}
			}
			return self.clients.openWindow(url);
		})
	);
});
