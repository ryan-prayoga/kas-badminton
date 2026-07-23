// Logika inti game — port 1:1 dari server.js (gameCost, enrichGame, parse/validate,
// buildKoks). Semua fungsi murni; tidak ada I/O.

import type {
  EnrichedGame,
  EnrichedPlayer,
  GameCost,
  Kok,
  KokType,
  Player,
  StoredGame,
} from "./types";

export function normalizeName(name: unknown): string {
  return String(name ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeNameType(name: unknown): string {
  return normalizeName(name).slice(0, 60);
}

/** Normalisasi bentuk pemain (skor sudah tidak dipakai). Selalu balik 4 pemain. */
export function normalizeStoredGame<T extends Partial<StoredGame>>(game: T): StoredGame {
  const raw = (Array.isArray(game.players) ? game.players.slice(0, 4) : []) as unknown[];
  while (raw.length < 4) raw.push({ name: "", paid: false });
  const players: Player[] = raw.map((p) => ({
    name: normalizeName(typeof p === "string" ? p : (p as Player)?.name),
    paid: Boolean(typeof p === "object" && p ? (p as Player).paid : false),
  }));

  return {
    id: game.id ?? "",
    date: game.date ?? "",
    players,
    koks: Array.isArray(game.koks) ? (game.koks as Kok[]) : [],
    notes: game.notes ?? null,
    recordedBy: game.recordedBy ?? null,
    createdAt: game.createdAt ?? "",
    updatedAt: game.updatedAt ?? "",
  };
}

export function gameCost(game: Pick<StoredGame, "koks">): GameCost {
  const koks = Array.isArray(game.koks) ? game.koks : [];
  const perPerson = koks.reduce((s, k) => s + Number(k.pricePerPerson || 0), 0);
  return { perPerson, total: perPerson * 4, kokCount: koks.length };
}

export function enrichGame(game: Partial<StoredGame>): EnrichedGame {
  const g = normalizeStoredGame(game);
  const cost = gameCost(g);
  const players: EnrichedPlayer[] = g.players.map((p) => ({ ...p, amount: cost.perPerson }));
  const paidCount = players.filter((p) => p.paid).length;
  const paidTotal = players.filter((p) => p.paid).reduce((s) => s + cost.perPerson, 0);
  return {
    ...g,
    players,
    pairs: {
      a: { players: [players[0], players[1]] },
      b: { players: [players[2], players[3]] },
    },
    cost,
    summary: {
      paidCount,
      unpaidCount: players.length - paidCount,
      paidTotal,
      unpaidTotal: cost.total - paidTotal,
      allPaid: paidCount === 4,
    },
  };
}

// --- Parse & validasi pemain dari body request ---

interface PairsBody {
  pairs?: { a?: unknown[]; b?: unknown[] };
  players?: unknown[];
}

export function parsePlayersFromBody(
  body: PairsBody,
  existing?: Player[],
): { players: Player[]; error?: undefined } | { error: string; players?: undefined } {
  const mapEntry = (p: unknown, i: number): Player => {
    if (typeof p === "string") {
      return { name: normalizeName(p), paid: Boolean(existing?.[i]?.paid) };
    }
    const obj = p as Player | undefined;
    return {
      name: normalizeName(obj?.name),
      paid: obj?.paid !== undefined ? Boolean(obj.paid) : Boolean(existing?.[i]?.paid),
    };
  };

  if (body.pairs && typeof body.pairs === "object") {
    const a = Array.isArray(body.pairs.a) ? body.pairs.a : [];
    const b = Array.isArray(body.pairs.b) ? body.pairs.b : [];
    const raw = [...a, ...b];
    if (raw.length !== 4) return { error: "Harus 2 pasangan (4 pemain)" };
    return { players: raw.map(mapEntry) };
  }

  if (Array.isArray(body.players) && body.players.length === 4) {
    return { players: body.players.map(mapEntry) };
  }

  return { error: "Harus isi 4 nama pemain (2 pasangan)" };
}

export function validatePlayers(players: Player[] | undefined): string | null {
  if (!players || players.length !== 4 || players.some((p) => !p.name)) {
    return "Harus isi 4 nama pemain";
  }
  if (new Set(players.map((p) => p.name.toLowerCase())).size !== 4) {
    return "Nama pemain tidak boleh dobel";
  }
  return null;
}

// --- Bangun koks (snapshot harga) dari body ---

function findKokType(kokTypes: KokType[], typeId: string | null | undefined): KokType | null {
  if (!typeId) return null;
  return kokTypes.find((t) => t.id === typeId) ?? null;
}

interface KokEntryRaw {
  id?: string;
  typeId?: string | null;
  typeName?: string | null;
  pricePerPerson?: number | string;
}

export function normalizeKokEntry(
  raw: KokEntryRaw | undefined,
  defaultPrice: number,
  kokTypes: KokType[],
  genId: () => string,
): Kok {
  const type = findKokType(kokTypes, raw?.typeId);
  let price = Number(raw?.pricePerPerson);
  if (!Number.isFinite(price)) {
    price = type ? type.pricePerPerson : defaultPrice;
  }
  let typeName = raw?.typeName != null ? String(raw.typeName).trim().slice(0, 60) : "";
  if (!typeName && type) typeName = type.name;
  return {
    id: raw?.id || genId(),
    typeId: type ? type.id : (raw?.typeId ?? null),
    typeName: typeName || null,
    pricePerPerson: Math.round(price),
  };
}

interface KoksBody {
  koks?: KokEntryRaw[];
  kokCount?: number | string;
  typeId?: string | null;
  pricePerPerson?: number | string;
}

export function buildKoks(
  body: KoksBody,
  defaultPrice: number,
  kokTypes: KokType[],
  genId: () => string,
): Kok[] {
  const source = Array.isArray(body.koks) ? body.koks : null;
  if (!source || source.length === 0) {
    const count = Math.max(1, Math.min(50, Number(body.kokCount) || 1));
    const type = findKokType(kokTypes, body.typeId);
    return Array.from({ length: count }, () =>
      normalizeKokEntry(
        {
          typeId: type?.id ?? null,
          typeName: type?.name ?? null,
          pricePerPerson: Number.isFinite(Number(body.pricePerPerson))
            ? Math.round(Number(body.pricePerPerson))
            : type
              ? type.pricePerPerson
              : defaultPrice,
        },
        defaultPrice,
        kokTypes,
        genId,
      ),
    );
  }
  let koks = source.slice(0, 50).map((k) => normalizeKokEntry(k, defaultPrice, kokTypes, genId));
  if (koks.length === 0) {
    koks = [normalizeKokEntry({}, defaultPrice, kokTypes, genId)];
  }
  return koks;
}
