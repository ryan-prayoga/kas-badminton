// Klien SSE ke /api/v1/events (API.md §8). Native EventSource gak bisa
// kirim header custom, jadi dipakai fetch + ReadableStream yang diparse
// manual — token sesi tetap lewat header Authorization, gak nempel di URL.
// Satu koneksi lintas klub aktif (bukan per klub), resume via
// Last-Event-ID, reconnect exponential backoff. Store baca lewat on() buat
// nambal entitas yang berubah, bukan refetch semua (PLAN.md §4.2).
import { getToken } from '$lib/stores/session.svelte';

type EventHandler = (data: unknown) => void;

const handlers = new Map<string, Set<EventHandler>>();
let lastEventId: string | null = null;
let reconnectDelay = 1000;
const MAX_RECONNECT_DELAY_MS = 30000;
let activeClubIds: string[] = [];
let generation = 0; // naik tiap connect/disconnect — matiin loop lama yang masih jalan

export function on(eventType: string, handler: EventHandler): () => void {
	if (!handlers.has(eventType)) handlers.set(eventType, new Set());
	handlers.get(eventType)!.add(handler);
	return () => handlers.get(eventType)?.delete(handler);
}

export function connectRealtime(clubIds: string[]) {
	if (typeof window === 'undefined' || clubIds.length === 0) return;
	activeClubIds = clubIds;
	generation += 1;
	void run(generation);
}

export function disconnectRealtime() {
	generation += 1;
	activeClubIds = [];
}

async function run(myGeneration: number) {
	while (myGeneration === generation) {
		try {
			await streamOnce(myGeneration);
			reconnectDelay = 1000; // sempat konek & baca sampai putus wajar → reset backoff
		} catch {
			// diamkan — reconnect di bawah lewat backoff
		}
		if (myGeneration !== generation) return;
		await sleep(reconnectDelay);
		reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
	}
}

async function streamOnce(myGeneration: number) {
	const qs = activeClubIds.map((id) => `club_id=${encodeURIComponent(id)}`).join('&');
	const headers = new Headers();
	const token = getToken();
	if (token) headers.set('Authorization', `Bearer ${token}`);
	if (lastEventId) headers.set('Last-Event-ID', lastEventId);

	const res = await fetch(`/api/v1/events?${qs}`, { headers });
	if (!res.ok || !res.body) throw new Error(`SSE gagal konek (${res.status})`);

	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';

	try {
		while (myGeneration === generation) {
			const { value, done } = await reader.read();
			if (done) return;
			buffer += decoder.decode(value, { stream: true });

			let sep: number;
			while ((sep = buffer.indexOf('\n\n')) !== -1) {
				const chunk = buffer.slice(0, sep);
				buffer = buffer.slice(sep + 2);
				parseChunk(chunk);
			}
		}
	} finally {
		void reader.cancel().catch(() => {});
	}
}

function parseChunk(chunk: string) {
	let eventType = 'message';
	const dataLines: string[] = [];
	for (const line of chunk.split('\n')) {
		if (line.startsWith(':')) continue; // komentar/heartbeat (": ping")
		if (line.startsWith('event:')) eventType = line.slice(6).trim();
		else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
		else if (line.startsWith('id:')) lastEventId = line.slice(3).trim();
	}
	if (dataLines.length === 0) return;
	let data: unknown;
	try {
		data = JSON.parse(dataLines.join('\n'));
	} catch {
		return;
	}
	for (const handler of handlers.get(eventType) ?? []) handler(data);
}

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
