// Klien tipis GET /me, GET .../me/bill (API.md §1, §4) — dipakai
// lib/stores/club.svelte.ts dan lib/stores/bill.svelte.ts.
import { api } from './client';

export type MeMembership = {
	club_id: string;
	club_slug: string;
	club_name: string;
	role: string;
	role_expires_at?: string;
	auto_deduct: boolean;
};

export type Me = {
	id: string;
	username?: string;
	display_name: string;
	phone?: string;
	memberships: MeMembership[];
};

export function fetchMe(): Promise<Me> {
	return api.get<Me>('/me');
}

export type BillItem = {
	kind: 'game';
	id: string; // game_players.id — bukan game_id (API.md §4)
	game_id: string;
	amount: number;
	played_on: string;
	status: 'unpaid' | 'pending_review' | 'disputed';
	// Cuma terisi kalau status pending_review (F6/2) — dipakai buat
	// "batalkan klaim" (PayDialog.svelte).
	payment_id?: string;
	claimed_at?: string;
};

export type MyBill = {
	total_owed: number;
	wallet_balance: number;
	auto_deduct: boolean;
	items: BillItem[];
};

export function fetchMyBill(clubId: string): Promise<MyBill> {
	return api.get<MyBill>(`/clubs/${clubId}/me/bill`);
}
