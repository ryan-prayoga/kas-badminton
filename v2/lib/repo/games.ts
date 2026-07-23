// Repo game — port routes /api/games* server.js. Per-row + transaksi; cek stok fresh.

import { prisma } from "@/lib/db";
import { DomainError } from "@/lib/domain/errors";
import { normalizeKokEntry, normalizeStoredGame } from "@/lib/domain/game";
import { stockDeltas, stockDiffError } from "@/lib/domain/stock";
import type { Kok, Player, StoredGame } from "@/lib/domain/types";
import { todayWIB, uid } from "@/lib/domain/util";
import type { Prisma } from "@/lib/generated/prisma/client";
import { rowToGame } from "./mappers";
import { applyStockDeltasTx, readKokTypesTx, rememberPlayersTx } from "./helpers";

type JsonArray = Prisma.InputJsonValue;

async function getGameTx(tx: Prisma.TransactionClient, id: string): Promise<StoredGame> {
  const row = await tx.games.findUnique({ where: { id } });
  if (!row) throw new DomainError("Game tidak ditemukan", 404);
  return rowToGame(row);
}

export interface CreateGameInput {
  players: Player[];
  koks: Kok[];
  date?: string;
  notes?: string;
  recordedBy: string;
}

export async function createGame(input: CreateGameInput): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const types = await readKokTypesTx(tx);
    const stockErr = stockDiffError(types, [], input.koks);
    if (stockErr) throw new DomainError(stockErr);

    await rememberPlayersTx(
      tx,
      input.players.map((p) => p.name),
    );
    await applyStockDeltasTx(tx, stockDeltas([], input.koks));

    const now = new Date();
    await tx.games.create({
      data: {
        id: uid(),
        date: input.date || todayWIB(),
        players: input.players as unknown as JsonArray,
        scores: {},
        koks: input.koks as unknown as JsonArray,
        notes: input.notes ? input.notes.trim() : "",
        recorded_by: input.recordedBy,
        created_at: now,
        updated_at: now,
      },
    });
  });
}

export interface UpdateGameInput {
  date?: string;
  notes?: string;
  players?: Player[];
  koks?: Kok[];
}

export async function updateGame(id: string, input: UpdateGameInput): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const game = await getGameTx(tx, id);
    const data: Prisma.gamesUpdateInput = { updated_at: new Date() };

    if (input.date) data.date = String(input.date);
    if (input.notes !== undefined) data.notes = String(input.notes || "").trim();

    if (input.players) {
      data.players = input.players as unknown as JsonArray;
      await rememberPlayersTx(
        tx,
        input.players.map((p) => p.name),
      );
    }

    if (input.koks && input.koks.length > 0) {
      const types = await readKokTypesTx(tx);
      const stockErr = stockDiffError(types, game.koks, input.koks);
      if (stockErr) throw new DomainError(stockErr);
      data.koks = input.koks as unknown as JsonArray;
      await applyStockDeltasTx(tx, stockDeltas(game.koks, input.koks));
    }

    await tx.games.update({ where: { id }, data });
  });
}

export async function deleteGame(id: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const game = await getGameTx(tx, id);
    await applyStockDeltasTx(tx, stockDeltas(game.koks, []));
    await tx.games.delete({ where: { id } });
  });
}

export async function setPlayerPaid(gameId: string, index: number, paid: boolean): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const game = await getGameTx(tx, gameId);
    if (!Number.isInteger(index) || index < 0 || index > 3) {
      throw new DomainError("Index pemain 0-3");
    }
    game.players[index].paid = paid;
    await tx.games.update({
      where: { id: gameId },
      data: { players: game.players as unknown as JsonArray, updated_at: new Date() },
    });
  });
}

export async function setAllPaid(gameId: string, paid: boolean): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const game = await getGameTx(tx, gameId);
    const players = game.players.map((p) => ({ ...p, paid }));
    await tx.games.update({
      where: { id: gameId },
      data: { players: players as unknown as JsonArray, updated_at: new Date() },
    });
  });
}

// --- koks per-game ---

export async function addKok(gameId: string, raw: Partial<Kok>, defaultPrice: number): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const game = await getGameTx(tx, gameId);
    const types = await readKokTypesTx(tx);
    const kok = normalizeKokEntry(raw, defaultPrice, types, uid);
    const stockErr = stockDiffError(types, [], [kok]);
    if (stockErr) throw new DomainError(stockErr);
    game.koks.push(kok);
    await applyStockDeltasTx(tx, stockDeltas([], [kok]));
    await tx.games.update({
      where: { id: gameId },
      data: { koks: game.koks as unknown as JsonArray, updated_at: new Date() },
    });
  });
}

export async function removeKok(gameId: string, kokId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const game = await getGameTx(tx, gameId);
    if (game.koks.length <= 1) throw new DomainError("Minimal 1 kok per game");
    const removed = game.koks.find((k) => k.id === kokId);
    if (!removed) throw new DomainError("Kok tidak ditemukan", 404);
    game.koks = game.koks.filter((k) => k.id !== kokId);
    if (removed.typeId) await applyStockDeltasTx(tx, new Map([[removed.typeId, 1]]));
    await tx.games.update({
      where: { id: gameId },
      data: { koks: game.koks as unknown as JsonArray, updated_at: new Date() },
    });
  });
}

export async function patchKok(
  gameId: string,
  kokId: string,
  fields: { typeId?: string | null; typeName?: string | null; pricePerPerson?: number },
  defaultPrice: number,
): Promise<void> {
  if (
    fields.typeId === undefined &&
    fields.typeName === undefined &&
    fields.pricePerPerson === undefined
  ) {
    throw new DomainError("Tidak ada field yang diubah");
  }
  await prisma.$transaction(async (tx) => {
    const game = await getGameTx(tx, gameId);
    const kok = game.koks.find((k) => k.id === kokId);
    if (!kok) throw new DomainError("Kok tidak ditemukan", 404);
    const types = await readKokTypesTx(tx);
    const prevTypeId = kok.typeId || null;
    const merged = normalizeKokEntry(
      {
        id: kok.id,
        typeId: fields.typeId !== undefined ? fields.typeId : kok.typeId,
        typeName: fields.typeName !== undefined ? fields.typeName : kok.typeName,
        pricePerPerson:
          fields.pricePerPerson !== undefined ? fields.pricePerPerson : kok.pricePerPerson,
      },
      defaultPrice,
      types,
      uid,
    );
    if (!Number.isFinite(Number(merged.pricePerPerson)) || merged.pricePerPerson < 0) {
      throw new DomainError("pricePerPerson harus angka >= 0");
    }
    Object.assign(kok, merged);
    if (prevTypeId !== (kok.typeId || null)) {
      const stockErr = stockDiffError(
        types,
        prevTypeId ? [{ id: "", typeId: prevTypeId, typeName: null, pricePerPerson: 0 }] : [],
        kok.typeId ? [{ id: "", typeId: kok.typeId, typeName: null, pricePerPerson: 0 }] : [],
      );
      if (stockErr) throw new DomainError(stockErr);
      const deltas = new Map<string, number>();
      if (prevTypeId) deltas.set(prevTypeId, 1);
      if (kok.typeId) deltas.set(kok.typeId, (deltas.get(kok.typeId) ?? 0) - 1);
      await applyStockDeltasTx(tx, deltas);
    }
    await tx.games.update({
      where: { id: gameId },
      data: { koks: game.koks as unknown as JsonArray, updated_at: new Date() },
    });
  });
}

/** Normalisasi game apa adanya (dipakai kalau perlu re-store). */
export function normalize(game: Partial<StoredGame>): StoredGame {
  return normalizeStoredGame(game);
}
