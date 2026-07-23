// Domain types — snapshot semantics: harga per-kok disimpan immutable di dalam game.

export interface Player {
  name: string;
  paid: boolean;
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

export interface DbSnapshot {
  settings: { defaultPricePerPerson: number; merchantQris: string };
  players: PlayerRow[];
  games: StoredGame[];
  kokTypes: KokType[];
  carry: CarryMap;
  totalExpense: number;
}
