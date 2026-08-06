// Payload bootstrap — port dari summarize() server.js. Murni: dari DbSnapshot → payload UI.

import { buildDebtSummary } from "./debt";
import { enrichGame } from "./game";
import { enrichTournament } from "./tournament";
import type {
  DbSnapshot,
  DebtEntry,
  EnrichedGame,
  EnrichedTournament,
  ExpenseRow,
  KokType,
  PlayerRow,
} from "./types";

export interface SummaryPayload {
  settings: {
    defaultPricePerPerson: number;
    qrisEnabled: boolean;
    merchantQris?: string;
  };
  players: PlayerRow[];
  kokTypes: KokType[];
  games: EnrichedGame[];
  tournaments: EnrichedTournament[];
  debtSummary: DebtEntry[];
  kas?: { paid: number; expense: number; net: number };
  /** Rincian pengeluaran (admin) — untuk filter kas per bulan di statistik. */
  expenses?: ExpenseRow[];
}

/** Terbaru dulu — dipakai buat game maupun turnamen. */
function newestFirst(
  a: { date: string; createdAt: string },
  b: { date: string; createdAt: string },
): number {
  return (
    String(b.date).localeCompare(String(a.date)) ||
    String(b.createdAt).localeCompare(String(a.createdAt))
  );
}

export function summarize(db: DbSnapshot, isAdmin: boolean): SummaryPayload {
  const games = db.games.slice().sort(newestFirst).map(enrichGame);
  const tournaments = (db.tournaments ?? []).slice().sort(newestFirst).map(enrichTournament);

  const settings: SummaryPayload["settings"] = {
    defaultPricePerPerson: db.settings.defaultPricePerPerson,
    qrisEnabled: Boolean(db.settings.merchantQris),
  };
  if (isAdmin) settings.merchantQris = db.settings.merchantQris || "";

  const payload: SummaryPayload = {
    settings,
    players: db.players,
    kokTypes: db.kokTypes ?? [],
    games,
    tournaments,
    debtSummary: buildDebtSummary(games, db.carry ?? {}, tournaments),
  };

  // Saldo kas transparan ke publik juga (bukan cuma admin) — cuma total masuk/keluar
  // dan tanggal per pembelian (lihat select-nya di repo/snapshot.ts), bukan detail
  // sensitif kayak siapa yang catat atau catatan pembelian.
  // Iuran patungan turnamen (feePaid) SENGAJA gak masuk sini — itu pool terpisah,
  // ditampilkan sendiri di kartu "Iuran Turnamen". Cuma kok (kokPaid) yang kas asli.
  const paid =
    games.reduce((s, g) => s + g.summary.paidTotal, 0) +
    tournaments.reduce((s, t) => s + t.cost.kokPaid, 0);
  // Bisa negatif kalau penyesuaian "kas masuk" > total keluar — net tetap harus bener.
  const expense = Number(db.totalExpense) || 0;
  payload.kas = { paid, expense, net: paid - expense };
  payload.expenses = db.expenses ?? [];

  return payload;
}
