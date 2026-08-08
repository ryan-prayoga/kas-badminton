// Klien .../side-bets + games/{id}/settle-bet (API.md §3, PLAN.md §8.4).
// SENGAJA tidak ada field rupiah di tipe-tipe ini — taruhan barang tidak
// pernah dinilai uang (lihat komentar internal/http/side_bets.go).
import { api } from './client';

export type SideBet = {
	id: string;
	game_id?: string;
	debtor_id: string;
	creditor_id: string;
	item: string;
	status: 'open' | 'settled' | 'cancelled';
	settled_at?: string;
	created_by?: string;
	created_at: string;
};

export function listSideBets(clubId: string, openOnly = false): Promise<SideBet[]> {
	return api
		.get<{ items: SideBet[] }>(`/clubs/${clubId}/side-bets`, openOnly ? { open: 'true' } : undefined)
		.then((r) => r.items);
}

export function createSideBet(
	clubId: string,
	input: { debtor_id: string; creditor_id: string; item: string; game_id?: string }
): Promise<SideBet> {
	return api.post(`/clubs/${clubId}/side-bets`, input);
}

export function updateSideBetStatus(clubId: string, id: string, status: 'settled' | 'cancelled'): Promise<SideBet> {
	return api.patch(`/clubs/${clubId}/side-bets/${id}`, { status });
}

// settleBet — preset "yang kalah bayar kok" (§8.2, §8.4): pindahkan
// payer_id semua baris main ke pemain pertama sisi kalah. Balikan
// bentuknya sama dengan Game (games.ts) tapi cukup ambil field yang
// dipakai UI di sini.
export function settleBet(clubId: string, gameId: string): Promise<unknown> {
	return api.post(`/clubs/${clubId}/games/${gameId}/settle-bet`);
}
