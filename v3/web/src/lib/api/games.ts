// Klien .../games (API.md §3) — GET dipakai sejak F1/F2 ("Main terakhirku"
// di Beranda); POST/undo/dispute ditambah F5/5 buat tab Main.
import { api } from './client';

export type GameSummary = {
	id: string;
	club_id: string;
	played_on: string;
	format: string;
	notes?: string;
	created_at: string;
	version: number;
	score_format?: string;
	winner_side?: string;
};

export type GamePlayer = {
	id: string;
	user_id: string;
	payer_id: string;
	side: 'a' | 'b';
	slot: number;
	amount: number;
	paid_at?: string;
	disputed_at?: string;
	dispute_note?: string;
};

export type GameSet = { game_no: number; a: number; b: number };

export type Game = GameSummary & {
	players: GamePlayer[];
	koks?: { id: string; kok_type_id?: string; type_name?: string; price_per_person: number; qty: number }[];
	score?: GameSet[];
};

export function listRecentGames(clubId: string, limit = 3): Promise<GameSummary[]> {
	return api.get<{ items: GameSummary[] }>(`/clubs/${clubId}/games`, { limit: String(limit) }).then((r) => r.items);
}

export function listGames(clubId: string, limit = 30, before?: string): Promise<{ items: GameSummary[]; next_cursor?: string }> {
	return api.get(`/clubs/${clubId}/games`, { limit: String(limit), before });
}

export function getGame(clubId: string, gameId: string): Promise<Game> {
	return api.get(`/clubs/${clubId}/games/${gameId}`);
}

export type CreateGamePlayerInput = { user_id: string; side: 'a' | 'b'; slot: number; payer_id?: string };
export type CreateGameKokInput = { type_name: string; price_per_person: number; qty: number };
export type CreateGameScoreInput = { format: 'single' | 'bo3' | 'rally42'; games: { a: number; b: number }[] };

export type CreateGameInput = {
	played_on: string;
	format: 'single' | 'ganda' | 'rotasi';
	notes?: string;
	players: CreateGamePlayerInput[];
	koks: CreateGameKokInput[];
	score?: CreateGameScoreInput;
};

export function createGame(clubId: string, input: CreateGameInput): Promise<Game> {
	return api.post(`/clubs/${clubId}/games`, input);
}

// undoGame — batalkan cepat (§9.4), jendela 8 detik yang ditegakkan SERVER
// (kalau klien terlambat/jaringan lambat, pesan galatnya jujur bilang lewat
// jendela, bukan diam-diam gagal).
export function undoGame(clubId: string, gameId: string): Promise<{ ok: boolean }> {
	return api.post(`/clubs/${clubId}/games/${gameId}/undo`);
}

export function disputeGamePlayer(clubId: string, gameId: string, userId: string, note: string): Promise<GamePlayer> {
	return api.post(`/clubs/${clubId}/games/${gameId}/players/${userId}/dispute`, { note });
}

export function resolveDispute(clubId: string, gameId: string, userId: string): Promise<GamePlayer> {
	return api.post(`/clubs/${clubId}/games/${gameId}/players/${userId}/resolve-dispute`);
}
