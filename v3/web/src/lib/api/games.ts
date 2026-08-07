// Klien tipis GET .../games (API.md §3, sudah ada sejak F1/F2) — dipakai
// "Main terakhirku" di Beranda (F5/3).
import { api } from './client';

export type GameSummary = {
	id: string;
	club_id: string;
	played_on: string;
	format: string;
	notes?: string;
	created_at: string;
	version: number;
};

export function listRecentGames(clubId: string, limit = 3): Promise<GameSummary[]> {
	return api.get<{ items: GameSummary[] }>(`/clubs/${clubId}/games`, { limit: String(limit) }).then((r) => r.items);
}
