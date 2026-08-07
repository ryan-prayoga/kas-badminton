// Status jaringan — dipakai outbox.ts buat mutuskan kapan replay dan UI
// buat nunjukin "mode pesawat" (PLAN.md §11 Offline & keandalan). App ini
// SPA statis murni (routes/+layout.ts: ssr=false), jadi navigator.onLine
// selalu tersedia begitu kode ini jalan (client-only).
let online = $state(typeof navigator === 'undefined' ? true : navigator.onLine);

const onlineListeners = new Set<() => void>();
let watcherStarted = false;

export function isOnline(): boolean {
	return online;
}

// dipanggil saat balik online — outbox.ts pakai ini buat mancing replay()
// tanpa network.svelte.ts perlu tahu apa itu outbox (hindari import siklik).
export function onOnline(cb: () => void): () => void {
	onlineListeners.add(cb);
	return () => onlineListeners.delete(cb);
}

export function initNetworkWatcher() {
	if (watcherStarted || typeof window === 'undefined') return;
	watcherStarted = true;
	window.addEventListener('online', () => {
		online = true;
		for (const cb of onlineListeners) cb();
	});
	window.addEventListener('offline', () => {
		online = false;
	});
}
