// Row → domain mappers (port rowToGame / rowToKokType server.js).

import { normalizeStoredGame } from "@/lib/domain/game";
import { normalizeStoredTournament } from "@/lib/domain/tournament";
import type { KokType, StoredGame, StoredTournament } from "@/lib/domain/types";
import type {
  games as GameRow,
  kok_types as KokTypeRow,
  tournaments as TournamentRow,
} from "@/lib/generated/prisma/client";

export function rowToGame(r: GameRow): StoredGame {
  return normalizeStoredGame({
    id: r.id,
    date: r.date,
    players: r.players as unknown as StoredGame["players"],
    koks: r.koks as unknown as StoredGame["koks"],
    notes: r.notes,
    recordedBy: r.recorded_by ?? null,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  });
}

export function rowToTournament(r: TournamentRow): StoredTournament {
  return normalizeStoredTournament({
    id: r.id,
    name: r.name,
    date: r.date,
    endDate: r.end_date,
    size: r.size,
    format: r.format as StoredTournament["format"],
    fee: r.fee,
    scoreFormat: r.score_format as StoredTournament["scoreFormat"],
    pairs: r.pairs as unknown as StoredTournament["pairs"],
    results: r.results as unknown as StoredTournament["results"],
    koks: r.koks as unknown as StoredTournament["koks"],
    fees: r.fees as unknown as StoredTournament["fees"],
    matchKokPaid: r.match_kok_paid as unknown as StoredTournament["matchKokPaid"],
    notes: r.notes,
    recordedBy: r.recorded_by ?? null,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  });
}

export function rowToKokType(r: KokTypeRow): KokType {
  return {
    id: r.id,
    name: r.name,
    pricePerPerson: Number(r.price_per_person) || 0,
    pricePerSlop: Math.max(0, Math.round(Number(r.price_per_slop) || 0)),
    stock: Number.isFinite(Number(r.stock)) ? Math.max(0, Math.round(Number(r.stock))) : 0,
    active: r.active !== false,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}
