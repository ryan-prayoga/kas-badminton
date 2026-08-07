// Registrasi service worker + ajakan pembaruan versi (PLAN.md §14 F5).
// Dipanggil sekali dari root layout. Hanya jalan di build produksi — di dev
// server SW bikin cache nyangkut dan ganggu lihat perubahan (HMR sudah cukup
// buat dev, lihat vite.config.ts).
import { toast } from '$lib/components/ui';

let reloading = false;

export function registerServiceWorker() {
	if (import.meta.env.DEV) return;
	if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

	// SW baru sudah skipWaiting() (dipicu tombol "Muat ulang" di notifyUpdate)
	// -> event ini nembak sekali di semua tab terbuka. Reload biar semua
	// pakai versi baru, guard cegah reload dobel kalau event nembak >1x.
	navigator.serviceWorker.addEventListener('controllerchange', () => {
		if (reloading) return;
		reloading = true;
		window.location.reload();
	});

	navigator.serviceWorker
		.register('/sw.js')
		.then((reg) => {
			// Ada worker nunggu pas load pertama — berarti tab lain sudah
			// update duluan selagi tab ini belum dibuka.
			if (reg.waiting) notifyUpdate(reg.waiting);

			reg.addEventListener('updatefound', () => {
				const installing = reg.installing;
				if (!installing) return;
				installing.addEventListener('statechange', () => {
					// installed + navigator.serviceWorker.controller sudah ada =
					// ini genuinely versi baru menggantikan yang lama, BUKAN
					// instalasi pertama kali (controller masih kosong pas awal,
					// jangan tawarin "update" buat first-install).
					if (installing.state === 'installed' && navigator.serviceWorker.controller) {
						notifyUpdate(installing);
					}
				});
			});
		})
		.catch(() => {
			// Registrasi gagal (browser lama, dsb) — app tetap jalan normal
			// tanpa offline cache. Diam saja, jangan ganggu user dgn error teknis.
		});
}

function notifyUpdate(worker: ServiceWorker) {
	toast('Versi baru tersedia.', {
		tone: 'netral',
		closeDelay: 0,
		action: {
			label: 'Muat ulang',
			onClick: () => worker.postMessage({ type: 'SKIP_WAITING' })
		}
	});
}
