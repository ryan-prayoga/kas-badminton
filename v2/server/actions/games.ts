"use server";

import { mutate, type ActionResult } from "@/lib/action-util";
import { requireStaff, recordedByFor } from "@/lib/auth";
import { DomainError } from "@/lib/domain/errors";
import { buildKoks, normalizeKokEntry, parsePlayersFromBody, validatePlayers } from "@/lib/domain/game";
import type { Kok } from "@/lib/domain/types";
import { uid } from "@/lib/domain/util";
import {
  addKok,
  createGame,
  deleteGame,
  patchKok,
  removeKok,
  setAllPaid,
  setPlayerPaid,
  updateGame,
} from "@/lib/repo/games";
import { loadSnapshot } from "@/lib/repo/snapshot";

interface PlayersBody {
  pairs?: { a?: unknown[]; b?: unknown[] };
  players?: unknown[];
}
interface KoksBody {
  koks?: Array<Partial<Kok>>;
  kokCount?: number;
  typeId?: string | null;
  pricePerPerson?: number;
}
export type CreateGameBody = PlayersBody & KoksBody & { date?: string; notes?: string };

export async function createGameAction(body: CreateGameBody): Promise<ActionResult> {
  return mutate(async () => {
    const sess = await requireStaff();
    const parsed = parsePlayersFromBody(body);
    if (parsed.error) throw new DomainError(parsed.error);
    const err = validatePlayers(parsed.players);
    if (err) throw new DomainError(err);

    const snap = await loadSnapshot();
    const koks = buildKoks(body, snap.settings.defaultPricePerPerson, snap.kokTypes, uid);

    await createGame({
      players: parsed.players!,
      koks,
      date: body.date,
      notes: body.notes,
      recordedBy: recordedByFor(sess),
    });
  });
}

export async function updateGameAction(
  id: string,
  body: CreateGameBody,
): Promise<ActionResult> {
  return mutate(async () => {
    await requireStaff();
    const snap = await loadSnapshot();
    const input: Parameters<typeof updateGame>[1] = {};

    if (body.date) input.date = String(body.date);
    if (body.notes !== undefined) input.notes = String(body.notes ?? "");

    if (body.pairs || (Array.isArray(body.players) && body.players.length === 4)) {
      const parsed = parsePlayersFromBody(body);
      if (parsed.error) throw new DomainError(parsed.error);
      const err = validatePlayers(parsed.players);
      if (err) throw new DomainError(err);
      input.players = parsed.players!;
    }

    if (Array.isArray(body.koks) && body.koks.length > 0) {
      input.koks = body.koks
        .slice(0, 50)
        .map((k) => normalizeKokEntry(k, snap.settings.defaultPricePerPerson, snap.kokTypes, uid));
    }

    await updateGame(id, input);
  });
}

export async function deleteGameAction(id: string): Promise<ActionResult> {
  return mutate(async () => {
    await requireStaff();
    await deleteGame(id);
  });
}

export async function setPaidAction(
  gameId: string,
  index: number,
  paid: boolean,
): Promise<ActionResult> {
  return mutate(async () => {
    await requireStaff();
    if (typeof paid !== "boolean") throw new DomainError("paid harus boolean");
    await setPlayerPaid(gameId, index, paid);
  });
}

export async function markAllPaidAction(gameId: string, paid = true): Promise<ActionResult> {
  return mutate(async () => {
    await requireStaff();
    await setAllPaid(gameId, paid !== false);
  });
}

export async function addKokAction(gameId: string, raw: Partial<Kok>): Promise<ActionResult> {
  return mutate(async () => {
    await requireStaff();
    const snap = await loadSnapshot();
    await addKok(gameId, raw, snap.settings.defaultPricePerPerson);
  });
}

export async function removeKokAction(gameId: string, kokId: string): Promise<ActionResult> {
  return mutate(async () => {
    await requireStaff();
    await removeKok(gameId, kokId);
  });
}

export async function patchKokAction(
  gameId: string,
  kokId: string,
  fields: { typeId?: string | null; typeName?: string | null; pricePerPerson?: number },
): Promise<ActionResult> {
  return mutate(async () => {
    await requireStaff();
    const snap = await loadSnapshot();
    await patchKok(gameId, kokId, fields, snap.settings.defaultPricePerPerson);
  });
}
