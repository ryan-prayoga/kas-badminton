// Klien .../tournaments (API.md §5, F7). Bagan/klasemen DIHITUNG SERVER
// (server/internal/http/tournaments.go) tiap request — klien di sini
// cuma menampilkan bentuk yang sudah jadi, tidak pernah menghitung
// pemenang atau bagi kok sendiri (§0 "biaya dihitung server", pola sama
// games.ts).
import { api } from './client';

export type TournamentParticipant = { user_id?: string; name: string };
export type TournamentPair = {
	id?: string;
	slot: number;
	a?: TournamentParticipant;
	b?: TournamentParticipant;
};

export type MatchSide = { pair?: TournamentPair; bye: boolean };
export type MatchGameScore = { a: number; b: number };
export type MatchScore = { format: string; games: MatchGameScore[]; played_at?: string };

export type BracketMatch = {
	id: string;
	title: string;
	round: number;
	index: number;
	a: MatchSide;
	b: MatchSide;
	score?: MatchScore;
	games_won_a: number;
	games_won_b: number;
	winner?: 'a' | 'b' | '';
	auto_win: boolean;
	kok_total: number;
	played_on?: string;
};

export type BracketRound = { round: number; label: string; matches: BracketMatch[] };

export type StandingRow = {
	pair: TournamentPair;
	played: number;
	won: number;
	lost: number;
	games_for: number;
	games_against: number;
	points_for: number;
	points_against: number;
	diff: number;
};

export type TournamentCost = {
	kok_count: number;
	kok_total: number;
	kok_paid: number;
	participants: number;
	fee_total: number;
	fee_paid: number;
	fee_unpaid: number;
	paid_count: number;
	unpaid_count: number;
};

export type TournamentKok = {
	id: string;
	match_id?: string;
	kok_type_id?: string;
	type_name?: string;
	price_per_person: number;
	qty: number;
	used_on?: string;
};

export type TournamentKokCharge = {
	id: string;
	match_id?: string;
	user_id: string;
	name: string;
	amount: number;
	paid_at?: string;
	disputed_at?: string;
	charged_on?: string;
};

export type TournamentFee = {
	user_id: string;
	name: string;
	amount: number;
	paid_at?: string;
};

export type Tournament = {
	id: string;
	club_id: string;
	name: string;
	starts_on: string;
	ends_on?: string;
	format: 'knockout' | 'round_robin';
	size: number;
	fee: number;
	score_format: 'single' | 'bo3';
	notes?: string;
	status: 'akan-datang' | 'berjalan' | 'selesai';
	created_at: string;
	updated_at: string;
	version: number;
	pairs: TournamentPair[];
	rounds?: BracketRound[];
	matches?: BracketMatch[];
	standings?: StandingRow[];
	champion?: TournamentPair;
	played_count: number;
	total_count: number;
	finished: boolean;
	cost: TournamentCost;
	koks?: TournamentKok[];
	kok_charges?: TournamentKokCharge[];
	fees?: TournamentFee[];
};

export function listTournaments(clubId: string): Promise<Tournament[]> {
	return api.get<{ items: Tournament[] }>(`/clubs/${clubId}/tournaments`).then((r) => r.items);
}

export function getTournament(clubId: string, id: string): Promise<Tournament> {
	return api.get(`/clubs/${clubId}/tournaments/${id}`);
}

export type CreateTournamentPairInput = { slot: number; a?: string; b?: string };
export type CreateTournamentInput = {
	name: string;
	starts_on: string;
	ends_on?: string;
	format: 'knockout' | 'round_robin';
	size: number;
	fee: number;
	score_format: 'single' | 'bo3';
	notes?: string;
	pairs: CreateTournamentPairInput[];
};

export function createTournament(clubId: string, input: CreateTournamentInput): Promise<Tournament> {
	return api.post(`/clubs/${clubId}/tournaments`, input);
}

export function patchTournament(
	clubId: string,
	id: string,
	input: { fee?: number; notes?: string },
	ifMatch: number
): Promise<Tournament> {
	return api.patch(`/clubs/${clubId}/tournaments/${id}`, input, ifMatch);
}

export function scoreMatch(
	clubId: string,
	tournamentId: string,
	matchId: string,
	input: { format: 'single' | 'bo3'; games: MatchGameScore[]; played_at?: string }
): Promise<Tournament> {
	return api.post(`/clubs/${clubId}/tournaments/${tournamentId}/matches/${matchId}/score`, input);
}

export type AddKokInput = {
	kok_type_id?: string;
	type_name?: string;
	price_per_person?: number;
	qty: number;
	used_on?: string;
};

export function addMatchKok(clubId: string, tournamentId: string, matchId: string, input: AddKokInput): Promise<Tournament> {
	return api.post(`/clubs/${clubId}/tournaments/${tournamentId}/matches/${matchId}/koks`, input);
}

export function addTournamentKok(clubId: string, tournamentId: string, input: AddKokInput): Promise<Tournament> {
	return api.post(`/clubs/${clubId}/tournaments/${tournamentId}/koks`, input);
}

export function markFeePaid(clubId: string, tournamentId: string, userId: string): Promise<Tournament> {
	return api.post(`/clubs/${clubId}/tournaments/${tournamentId}/fees/${userId}/mark-paid`);
}

export function markKokChargesPaid(
	clubId: string,
	tournamentId: string,
	ids: string[]
): Promise<{ results: { id: string; ok: boolean; error?: string }[]; tournament: Tournament }> {
	return api.post(`/clubs/${clubId}/tournaments/${tournamentId}/kok-charges/mark-paid`, { ids });
}
