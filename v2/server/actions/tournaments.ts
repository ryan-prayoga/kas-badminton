"use server";

import { mutate, type ActionResult } from "@/lib/action-util";
import { recordedByFor, requireStaff } from "@/lib/auth";
import { DomainError } from "@/lib/domain/errors";
import type { Kok, MatchScore, ScoreFormat } from "@/lib/domain/types";
import {
  addTournamentKoks,
  createTournament,
  deleteTournament,
  removeTournamentKok,
  setAllFeesPaid,
  setFeePaid,
  setMatchScore,
  updateTournament,
} from "@/lib/repo/tournaments";
import { loadSnapshot } from "@/lib/repo/snapshot";

export interface CreateTournamentBody {
  name: string;
  date?: string;
  endDate?: string | null;
  size: number;
  fee?: number;
  scoreFormat?: ScoreFormat;
  pairs?: Array<{ a?: string; b?: string }>;
  koks?: Array<Partial<Kok>>;
  notes?: string;
}

export async function createTournamentAction(
  body: CreateTournamentBody,
): Promise<ActionResult<string>> {
  return mutate(async () => {
    const sess = await requireStaff();
    const snap = await loadSnapshot();
    return createTournament({
      name: body.name,
      date: body.date,
      endDate: body.endDate ?? null,
      size: Number(body.size),
      fee: Number(body.fee) || 0,
      scoreFormat: body.scoreFormat,
      pairs: body.pairs,
      koks: body.koks,
      notes: body.notes,
      recordedBy: recordedByFor(sess),
      defaultPrice: snap.settings.defaultPricePerPerson,
    });
  });
}

export async function updateTournamentAction(
  id: string,
  body: {
    name?: string;
    date?: string;
    endDate?: string | null;
    fee?: number;
    scoreFormat?: ScoreFormat;
    notes?: string;
    pairs?: Array<{ a?: string; b?: string }>;
  },
): Promise<ActionResult> {
  return mutate(async () => {
    await requireStaff();
    await updateTournament(id, body);
  });
}

export async function deleteTournamentAction(id: string): Promise<ActionResult> {
  return mutate(async () => {
    await requireStaff();
    await deleteTournament(id);
  });
}

export async function setMatchScoreAction(
  id: string,
  match: string,
  score: MatchScore | null,
): Promise<ActionResult> {
  return mutate(async () => {
    await requireStaff();
    await setMatchScore(id, match, score);
  });
}

export async function setFeePaidAction(
  id: string,
  index: number,
  paid: boolean,
): Promise<ActionResult> {
  return mutate(async () => {
    const sess = await requireStaff();
    if (typeof paid !== "boolean") throw new DomainError("paid harus boolean");
    await setFeePaid(id, index, paid, recordedByFor(sess));
  });
}

export async function markAllFeesPaidAction(id: string, paid = true): Promise<ActionResult> {
  return mutate(async () => {
    const sess = await requireStaff();
    await setAllFeesPaid(id, paid !== false, recordedByFor(sess));
  });
}

/**
 * `matchId` null/undefined = kok umum turnamen; isi buat mengikat ke satu partai.
 * `date` = hari kok dipakai (turnamen bisa lebih dari sehari).
 */
export async function addTournamentKoksAction(
  id: string,
  koks: Array<Partial<Kok>>,
  matchId?: string | null,
  date?: string,
): Promise<ActionResult> {
  return mutate(async () => {
    await requireStaff();
    const snap = await loadSnapshot();
    await addTournamentKoks(
      id,
      koks,
      snap.settings.defaultPricePerPerson,
      matchId ?? null,
      date,
    );
  });
}

export async function removeTournamentKokAction(id: string, kokId: string): Promise<ActionResult> {
  return mutate(async () => {
    await requireStaff();
    await removeTournamentKok(id, kokId);
  });
}
