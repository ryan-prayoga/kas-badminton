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

export interface DebtItem {
  gameId: string;
  date: string;
  name: string;
  amount: number;
  kokCount: number;
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
  createdAt: string;
}

/** Pengeluaran kas (beli stok), untuk filter per-periode di statistik. */
export interface ExpenseRow {
  amount: number;
  /** ISO datetime created_at */
  createdAt: string;
}

export interface DbSnapshot {
  settings: { defaultPricePerPerson: number; merchantQris: string };
  players: PlayerRow[];
  games: StoredGame[];
  kokTypes: KokType[];
  carry: CarryMap;
  totalExpense: number;
  /** Daftar pengeluaran (admin); kosong/undefined di public. */
  expenses?: ExpenseRow[];
}
