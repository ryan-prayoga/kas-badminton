// Factory store koleksi generik (PLAN.md §4: stores/ = state ternormalisasi
// + optimistic, offline/ = persistensi). Dipakai bills/games/members
// (F5/2-F5/5): $state map by id, baca awal dari cermin IndexedDB
// (offline-first), ditambal langsung oleh event SSE tanpa refetch
// (API.md §8, PLAN.md §4.2) — bukan class, ikut pola module function di
// lib/stores/session.svelte.ts.
import { getDB, mirrorKey } from '$lib/offline/db';

export type Entity = { id: string };

export function createCollectionStore<T extends Entity>(entityName: string) {
	let items = $state<Map<string, T>>(new Map());

	function list(): T[] {
		return [...items.values()];
	}

	function get(id: string): T | undefined {
		return items.get(id);
	}

	async function hydrateFromMirror() {
		const db = await getDB();
		const rows = await db.getAllFromIndex('mirror', 'entity', entityName);
		const map = new Map<string, T>();
		for (const row of rows) map.set(row.id, row.data as T);
		items = map;
	}

	// optimistic write + cermin — dipanggil dari lib/api/*.ts sesudah
	// enqueue outbox (F5/2+), dan dari handler SSE saat entitas penuh datang.
	async function upsert(entity: T) {
		items.set(entity.id, entity);
		const db = await getDB();
		await db.put('mirror', {
			key: mirrorKey(entityName, entity.id),
			entity: entityName,
			id: entity.id,
			data: entity,
			updatedAt: Date.now()
		});
	}

	async function remove(id: string) {
		items.delete(id);
		const db = await getDB();
		await db.delete('mirror', mirrorKey(entityName, id));
	}

	// tambal parsial — event SSE kadang cuma bawa sebagian field (mis.
	// bill.updated cuma bawa total_owed). Kalau entitasnya belum ada di
	// cache lokal, dilewatin — biar hydrate/fetch berikutnya yang mengisi,
	// daripada nyimpen objek setengah jadi.
	async function patch(id: string, partial: Partial<T>) {
		const current = items.get(id);
		if (!current) return;
		await upsert({ ...current, ...partial });
	}

	return { list, get, upsert, remove, patch, hydrateFromMirror };
}
