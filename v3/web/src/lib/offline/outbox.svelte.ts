// Outbox tulis (PLAN.md §11 "Antrean tulis") — aksi non-GET masuk
// IndexedDB dulu, dikirim saat memungkinkan. Idempotency-Key dibuat SEKALI
// saat enqueue dan dipakai ulang di tiap retry (API.md §0: kunci sama +
// body sama = aman diulang, itu yang mencegah dobel saat mode pesawat lalu
// online lagi). FIFO global + exponential backoff (1s→2s→...→30s, maks 6x
// otomatis); lewat itu diam di 'failed' sampai user tekan "coba lagi"
// (retryNow) — status per-aksi (menunggu · terkirim · gagal) dibaca UI
// lewat outboxStatuses().
import { getDB, type OutboxRecord } from './db';
import { api, ApiError } from '$lib/api/client';
import { isOnline, onOnline, initNetworkWatcher } from './network.svelte';

export type EnqueueInput = {
	method: 'POST' | 'PATCH' | 'DELETE';
	path: string;
	body?: unknown;
	ifMatch?: number;
	// aksi yang gak boleh diantre offline (mis. verifikasi pembayaran
	// bendahara, PLAN.md §11) — ditolak seketika kalau lagi offline,
	// bukan masuk antrean lalu gagal diam-diam nanti.
	onlineOnly?: boolean;
};

export class OfflineRejectedError extends Error {
	constructor(message = 'Aksi ini butuh koneksi internet.') {
		super(message);
	}
}

const BACKOFF_STEPS_MS = [1000, 2000, 4000, 8000, 16000, 30000];

let statuses = $state<Map<number, OutboxRecord>>(new Map());
let replaying = false;

export function outboxStatuses(): OutboxRecord[] {
	return [...statuses.values()].sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
}

// dipanggil sekali dari root layout — nyalain watcher jaringan, hydrate
// antrean lama dari IndexedDB (kalau app ditutup pas ada yang pending), lalu
// coba kirim.
export async function initOutbox() {
	initNetworkWatcher();
	onOnline(() => void replay());
	await hydrate();
	void replay();
}

async function hydrate() {
	const db = await getDB();
	const all = await db.getAll('outbox');
	statuses = new Map(all.filter((r) => r.id != null).map((r) => [r.id as number, r]));
}

export async function enqueue(input: EnqueueInput): Promise<number> {
	if (input.onlineOnly && !isOnline()) throw new OfflineRejectedError();

	const db = await getDB();
	const record: OutboxRecord = {
		idempotencyKey: crypto.randomUUID(),
		method: input.method,
		path: input.path,
		body: input.body,
		ifMatch: input.ifMatch,
		onlineOnly: input.onlineOnly,
		status: 'pending',
		attempts: 0,
		createdAt: Date.now()
	};
	const id = (await db.add('outbox', record)) as number;
	record.id = id;
	statuses.set(id, record);
	void replay();
	return id;
}

// tombol "coba lagi" manual — dipakai buat aksi yang sudah kehabisan jatah
// retry otomatis (PLAN.md §11: "tombol coba lagi").
export async function retryNow(id: number) {
	const db = await getDB();
	const record = await db.get('outbox', id);
	if (!record) return;
	record.status = 'pending';
	record.lastError = undefined;
	await db.put('outbox', record);
	statuses.set(id, { ...record });
	void replay();
}

export async function replay() {
	if (replaying || !isOnline()) return;
	replaying = true;
	try {
		const db = await getDB();
		const pending = (await db.getAllFromIndex('outbox', 'status', 'pending')).sort(
			(a, b) => (a.id ?? 0) - (b.id ?? 0)
		);
		for (const record of pending) {
			if (!isOnline() || record.id == null) break;
			await sendOne(record.id);
		}
	} finally {
		replaying = false;
	}
}

async function sendOne(id: number) {
	const db = await getDB();
	const record = await db.get('outbox', id);
	if (!record || record.status !== 'pending') return;

	record.status = 'sending';
	await db.put('outbox', record);
	statuses.set(id, { ...record });

	try {
		if (record.method === 'POST') await api.post(record.path, record.body);
		else if (record.method === 'PATCH') await api.patch(record.path, record.body, record.ifMatch);
		else await api.del(record.path);

		record.status = 'sent';
		await db.put('outbox', record);
		statuses.set(id, { ...record });
		// status 'sent' cuma buat UI sekilas — bersihkan sebentar biar
		// outbox tetap kecil, gak numpuk riwayat.
		setTimeout(() => void cleanup(id), 2000);
	} catch (err) {
		record.attempts += 1;
		record.lastError = err instanceof ApiError ? err.message : 'Gagal terkirim. Coba lagi.';
		record.status = 'failed';
		await db.put('outbox', record);
		statuses.set(id, { ...record });

		const withinAutoRetry = record.attempts <= BACKOFF_STEPS_MS.length;
		if (withinAutoRetry) {
			const delay = BACKOFF_STEPS_MS[record.attempts - 1];
			setTimeout(() => void requeue(id), delay);
		}
		// lewat batas: diam di 'failed', nunggu retryNow() manual — jangan
		// hajar server terus-terusan kalau memang lagi bermasalah.
	}
}

async function requeue(id: number) {
	const db = await getDB();
	const record = await db.get('outbox', id);
	if (!record || record.status !== 'failed') return;
	record.status = 'pending';
	await db.put('outbox', record);
	statuses.set(id, { ...record });
	void replay();
}

async function cleanup(id: number) {
	const db = await getDB();
	await db.delete('outbox', id);
	statuses.delete(id);
}
