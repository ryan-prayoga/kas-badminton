// Registrasi Web Push di sisi klien (PLAN.md §10.2, §14 F8). Terpisah
// dari lib/offline/sw.ts (itu urusan cache offline + ajakan update) —
// push cuma butuh service worker SUDAH terpasang, tidak menambah
// tanggung jawab baru ke sw.js selain dua listener (push,
// notificationclick) yang sudah ditambah di static/sw.js.
//
// iOS 16.4+ CUMA jalan kalau app sudah dipasang ke Home Screen
// (standalone) — §10.2. Fungsi di sini tidak mendeteksi itu secara
// eksplisit (Notification/PushManager memang tidak akan ada di Safari
// tab biasa di iOS), jadi isPushSupported() sudah otomatis false di
// situasi itu tanpa kode tambahan.
import { getVapidPublicKey, createPushSubscription, deletePushSubscription } from '$lib/api/notifications';

export function isPushSupported(): boolean {
	return (
		typeof navigator !== 'undefined' &&
		'serviceWorker' in navigator &&
		'PushManager' in window &&
		'Notification' in window
	);
}

export function pushPermission(): NotificationPermission | 'unsupported' {
	if (!isPushSupported()) return 'unsupported';
	return Notification.permission;
}

// urlBase64ToUint8Array — VAPID public key dikirim server sebagai base64
// URL-safe (webpush-go.GenerateVAPIDKeys), PushManager.subscribe minta
// Uint8Array mentah. Konversi baku, sama di semua implementasi Web Push.
function urlBase64ToUint8Array(base64: string): BufferSource {
	const padding = '='.repeat((4 - (base64.length % 4)) % 4);
	const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
	const raw = atob(b64);
	return Uint8Array.from(raw, (c) => c.charCodeAt(0)).buffer;
}

export async function currentSubscription(): Promise<PushSubscription | null> {
	if (!isPushSupported()) return null;
	const reg = await navigator.serviceWorker.ready;
	return reg.pushManager.getSubscription();
}

// subscribePush — minta izin (kalau belum), daftar ke browser, kirim ke
// server. Dipanggil dari tombol eksplisit di halaman preferensi — TIDAK
// PERNAH otomatis saat app dibuka (§10.2 "diminta SETELAH ada momen
// relevan, bukan saat pertama membuka app").
export async function subscribePush(): Promise<{ id: string; endpoint: string }> {
	if (!isPushSupported()) throw new Error('Perangkat/browser ini belum mendukung notifikasi push.');

	const permission = await Notification.requestPermission();
	if (permission !== 'granted') {
		throw new Error('Izin notifikasi ditolak. Nyalakan lewat pengaturan browser kalau berubah pikiran.');
	}

	const publicKey = await getVapidPublicKey();
	if (!publicKey) {
		throw new Error('Push belum tersedia di server ini.');
	}

	const reg = await navigator.serviceWorker.ready;
	let sub = await reg.pushManager.getSubscription();
	if (!sub) {
		sub = await reg.pushManager.subscribe({
			userVisibleOnly: true,
			applicationServerKey: urlBase64ToUint8Array(publicKey)
		});
	}
	return createPushSubscription(sub.toJSON() as PushSubscriptionJSON);
}

// unsubscribePush — cabut di browser DAN di server (id server dilewatkan
// pemanggil, disimpan dari respons subscribePush/daftar sebelumnya).
export async function unsubscribePush(serverId?: string): Promise<void> {
	const sub = await currentSubscription();
	if (sub) await sub.unsubscribe();
	if (serverId) await deletePushSubscription(serverId);
}
