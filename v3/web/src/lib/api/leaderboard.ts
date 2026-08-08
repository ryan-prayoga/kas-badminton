// Klien GET .../leaderboard (API.md §5, PLAN.md §8.3). 404 kalau saklar
// papan_peringkat mati di klub — ditangani pemanggil (routes/klub/peringkat).
import { api } from './client';

export type LeaderboardRow = {
	user_id: string;
	name: string;
	played: number;
	won: number;
	lost: number;
	win_rate_permil: number;
	current_streak: number;
	longest_win_streak: number;
};

export type Leaderboard = { season: string; rows: LeaderboardRow[] };

export function getLeaderboard(clubId: string, season?: string): Promise<Leaderboard> {
	return api.get(`/clubs/${clubId}/leaderboard`, season ? { season } : undefined);
}
