// Row → domain mappers (port rowToGame / rowToKokType server.js).

import { normalizeStoredGame } from "@/lib/domain/game";
import type { KokType, StoredGame } from "@/lib/domain/types";
import type { games as GameRow, kok_types as KokTypeRow } from "@/lib/generated/prisma/client";

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
