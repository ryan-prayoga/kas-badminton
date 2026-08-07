// Klien tipis POST /clubs, PATCH .../auto-deduct (API.md §2) — dipakai
// layar "belum punya klub" (F5/3) dan kartu Deposit di Beranda.
import { api } from './client';
import { enqueue } from '$lib/offline/outbox.svelte';

export type Club = {
	id: string;
	slug: string;
	name: string;
	timezone: string;
	status: string;
	version: number;
};

export function createClub(input: { slug: string; name: string }): Promise<Club> {
	return api.post<Club>('/clubs', input);
}

// auto-deduct BUKAN online-only (bukan uang beneran, cuma saklar preferensi
// — aman diantre kalau lagi offline).
export function setAutoDeduct(clubId: string, userId: string, autoDeduct: boolean): Promise<number> {
	return enqueue({
		method: 'PATCH',
		path: `/clubs/${clubId}/members/${userId}/auto-deduct`,
		body: { auto_deduct: autoDeduct }
	});
}
