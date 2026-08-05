// Domain types — snapshot semantics: harga per-kok disimpan immutable di dalam game.

export interface Player {
  name: string;
  paid: boolean;
  /** ISO datetime saat pemain ditandai lunas. Absen kalau belum bayar. */
  paidAt?: string;
  /** Nama admin/operator yang menandai lunas. */
  paidBy?: string;
}

export interface Kok {
  id: string;
  typeId: string | null;
  typeName: string | null;
  pricePerPerson: number;
}

export interface StoredGame {
  id: string;
  date: string;
  players: Player[];
  koks: Kok[];
  notes: string | null;
  recordedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface KokType {
  id: string;
  name: string;
  pricePerPerson: number;
  pricePerSlop: number;
  stock: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PlayerRow {
  name: string;
  photo: string | null;
}

export interface GameCost {
  perPerson: number;
  total: number;
  kokCount: number;
}

export interface EnrichedPlayer extends Player {
  amount: number;
}

export interface EnrichedGame extends StoredGame {
  players: EnrichedPlayer[];
  pairs: {
    a: { players: [EnrichedPlayer, EnrichedPlayer] };
    b: { players: [EnrichedPlayer, EnrichedPlayer] };
  };
  cost: GameCost;
  summary: {
    paidCount: number;
    unpaidCount: number;
    paidTotal: number;
    unpaidTotal: number;
    allPaid: boolean;
  };
}

/** Sumber tagihan: main biasa atau iuran patungan turnamen. */
export type DebtKind = "game" | "turnamen";

export interface DebtItem {
  /** id game, atau id turnamen kalau kind = "turnamen". */
  gameId: string;
  date: string;
  name: string;
  amount: number;
  kokCount: number;
  kind: DebtKind;
  /** Nama turnamen — hanya untuk kind "turnamen". */
  label?: string;
}

export interface DebtEntry {
  name: string;
  owedGross: number;
  items: DebtItem[];
  carry: number;
  total: number;
}

export type CarryMap = Record<string, number>;

export type PaymentType = "lunas" | "cicil" | "saldo_masuk" | "saldo_keluar";

/** Satu event bayar (lunas/cicil) atau penyesuaian saldo (saldo_masuk/saldo_keluar) — satu ledger di riwayat transaksi. */
export interface PaymentHistoryEntry {
  id: string;
  name: string;
  amount: number;
  type: PaymentType;
  recordedBy: string | null;
  gameId: string | null;
  tournamentId: string | null;
  createdAt: string;
}

// --- Turnamen (bagan single elimination) ---

/** Satu pasangan di slot babak pertama. Kedua nama kosong = slot BYE. */
export interface TournamentPair {
  id: string;
  /** Posisi slot di babak pertama, 0..size-1. */
  slot: number;
  a: string;
  b: string;
}

/** Status patungan satu peserta turnamen. */
export interface TournamentFee {
  name: string;
  paid: boolean;
  paidAt?: string;
  paidBy?: string;
}

/**
 * Format skor satu pertandingan.
 * - `single` — "biasa": satu game sampai 30.
 * - `bo3`    — rally poin 21, best of 3 game (menang 2 game).
 */
export type ScoreFormat = "single" | "bo3";

/** Skor satu game. */
export interface GameScore {
  a: number;
  b: number;
}

/** Skor satu pertandingan: daftar game + formatnya. `single` selalu tepat 1 game. */
export interface MatchScore {
  format: ScoreFormat;
  games: GameScore[];
  /** Tanggal partai ini dimainkan (YYYY-MM-DD) — penting di turnamen multi-hari. Skor lama tanpa ini jatuh ke tanggal mulai turnamen. */
  playedAt?: string;
}

/**
 * Sistem pertandingan.
 * - `knockout`    — sistem gugur; kalah sekali, habis.
 * - `round_robin` — semua lawan semua, juara dari klasemen.
 */
export type TournamentFormat = "knockout" | "round_robin";

/**
 * Kok turnamen. Sama seperti kok game (harga di-snapshot), plus `matchId`:
 * tiap partai boleh pakai jenis & harga kok yang beda. `null` = kok umum
 * turnamen (belum/tidak diikat ke partai tertentu).
 */
export interface TournamentKok extends Kok {
  matchId: string | null;
  /** Tanggal kok ini dipakai (YYYY-MM-DD) — penting di turnamen yang lebih dari sehari. */
  date: string;
}

export interface StoredTournament {
  id: string;
  name: string;
  /** Tanggal mulai (YYYY-MM-DD). */
  date: string;
  /** Tanggal selesai; null kalau turnamen cuma sehari. */
  endDate: string | null;
  format: TournamentFormat;
  /** Jumlah pasangan yang ikut (2–32). */
  size: number;
  /** Iuran patungan per orang (rupiah). */
  fee: number;
  /** Format skor bawaan untuk partai baru; tiap partai boleh beda. */
  scoreFormat: ScoreFormat;
  pairs: TournamentPair[];
  results: Record<string, MatchScore>;
  koks: TournamentKok[];
  fees: TournamentFee[];
  notes: string | null;
  recordedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Satu sisi pertandingan di bagan. */
export interface BracketSide {
  /** Pasangan yang mengisi sisi ini; null = belum ditentukan (nunggu babak sebelumnya). */
  pair: TournamentPair | null;
  /** true = slot kosong (BYE) — lawan otomatis lolos. */
  bye: boolean;
  /** Id match babak sebelumnya yang mengisi sisi ini (kalau round > 0). */
  from: string | null;
}

export interface BracketMatch {
  /** `r{round}-{index}` */
  id: string;
  round: number;
  index: number;
  a: BracketSide;
  b: BracketSide;
  score: MatchScore | null;
  /** Jumlah game yang dimenangkan tiap sisi (buat bo3; `single` maksimal 1). */
  gamesWon: { a: number; b: number };
  /** "a" | "b" | null. Terisi otomatis kalau salah satu sisi BYE. */
  winner: "a" | "b" | null;
  /** true = pemenang datang dari BYE, bukan dari skor. */
  autoWin: boolean;
  /** Kok yang dipakai di partai ini (boleh beda jenis & harga dari partai lain). */
  koks: TournamentKok[];
  /** Total rupiah kok partai ini. */
  kokTotal: number;
}

export interface BracketRound {
  round: number;
  label: string;
  matches: BracketMatch[];
}

export interface Bracket {
  rounds: BracketRound[];
  champion: TournamentPair | null;
}

/** Satu baris klasemen round robin. */
export interface StandingRow {
  pair: TournamentPair;
  played: number;
  won: number;
  lost: number;
  /** Game (set) yang dimenangkan / kebobolan. */
  gamesFor: number;
  gamesAgainst: number;
  /** Total poin skor dibuat / kemasukan. */
  pointsFor: number;
  pointsAgainst: number;
  /** pointsFor − pointsAgainst. */
  diff: number;
}

export interface RoundRobin {
  matches: BracketMatch[];
  standings: StandingRow[];
  /** Peringkat 1 kalau semua partai sudah main dan tidak seri di puncak. */
  champion: TournamentPair | null;
  playedCount: number;
  totalCount: number;
}

export interface TournamentCost {
  kokCount: number;
  /** Total rupiah kok yang dipakai (harga per kok = pricePerPerson × 4, sama seperti game). */
  kokTotal: number;
  /** Kok yang belum diikat ke partai mana pun. */
  looseKoks: TournamentKok[];
  participants: number;
  /** fee × jumlah peserta. */
  feeTotal: number;
  feePaid: number;
  feeUnpaid: number;
  paidCount: number;
  unpaidCount: number;
}

export interface EnrichedTournament extends StoredTournament {
  /** Terisi kalau format knockout. */
  bracket: Bracket | null;
  /** Terisi kalau format round robin. */
  roundRobin: RoundRobin | null;
  /** Semua partai, apa pun formatnya — dipakai buat kok per partai & ringkasan. */
  matches: BracketMatch[];
  champion: TournamentPair | null;
  /** Partai yang sudah ada hasilnya / total partai yang bisa dimainkan. */
  playedCount: number;
  totalCount: number;
  finished: boolean;
  cost: TournamentCost;
}

/** Pengeluaran kas (beli stok / penyesuaian saldo), untuk filter per-periode di statistik. */
export interface ExpenseRow {
  /** Positif = kas keluar, negatif = kas masuk (penyesuaian saldo). */
  amount: number;
  /** ISO datetime created_at */
  createdAt: string;
}

export interface DbSnapshot {
  settings: { defaultPricePerPerson: number; merchantQris: string };
  players: PlayerRow[];
  games: StoredGame[];
  tournaments: StoredTournament[];
  kokTypes: KokType[];
  carry: CarryMap;
  totalExpense: number;
  /** Daftar pengeluaran (admin); kosong/undefined di public. */
  expenses?: ExpenseRow[];
}
