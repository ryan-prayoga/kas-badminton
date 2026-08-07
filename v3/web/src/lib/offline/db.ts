// Database IndexedDB lokal (PLAN.md §4 folder layout: lib/offline/ =
// cermin IndexedDB + outbox tulis). Dua object store dipakai bareng:
// `mirror` — cache baca offline-first (lib/stores/collection.svelte.ts baca
// & tulis ke sini), dan `outbox` — antrean tulis (offline/outbox.ts, PLAN.md
// §11). Satu koneksi dibagi lewat getDB() supaya gak buka berkali-kali.
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

const DB_NAME = 'kok-v3';
const DB_VERSION = 1;

export type MirrorRecord = {
	key: string; // `${entity}:${id}` — satu store dipakai semua jenis entitas
	entity: string;
	id: string;
	data: unknown;
	updatedAt: number;
};

export type OutboxStatus = 'pending' | 'sending' | 'sent' | 'failed';

export type OutboxRecord = {
	id?: number; // autoIncrement, undefined sebelum tersimpan
	idempotencyKey: string;
	method: 'POST' | 'PATCH' | 'DELETE';
	path: string;
	body?: unknown;
	ifMatch?: number;
	onlineOnly?: boolean;
	status: OutboxStatus;
	attempts: number;
	lastError?: string;
	createdAt: number;
};

interface KokDB extends DBSchema {
	mirror: {
		key: string;
		value: MirrorRecord;
		indexes: { entity: string };
	};
	outbox: {
		key: number;
		value: OutboxRecord;
		indexes: { status: string };
	};
}

let dbPromise: Promise<IDBPDatabase<KokDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<KokDB>> {
	if (!dbPromise) {
		dbPromise = openDB<KokDB>(DB_NAME, DB_VERSION, {
			upgrade(db) {
				const mirror = db.createObjectStore('mirror', { keyPath: 'key' });
				mirror.createIndex('entity', 'entity');

				const outbox = db.createObjectStore('outbox', { keyPath: 'id', autoIncrement: true });
				outbox.createIndex('status', 'status');
			}
		});
	}
	return dbPromise;
}

export function mirrorKey(entity: string, id: string): string {
	return `${entity}:${id}`;
}
