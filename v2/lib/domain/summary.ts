// Payload bootstrap — port dari summarize() server.js. Murni: dari DbSnapshot → payload UI.

import { buildDebtSummary } from "./debt";
import { enrichGame } from "./game";
import type { DbSnapshot, DebtEntry, EnrichedGame, KokType, PlayerRow } from "./types";

export interface SummaryPayload {
  settings: {
    defaultPricePerPerson: number;
    qrisEnabled: boolean;
    merchantQris?: string;
  };
  players: PlayerRow[];
  kokTypes: KokType[];
  games: EnrichedGame[];
  debtSummary: DebtEntry[];
  kas?: { paid: number; expense: number; net: number };
}

export function summarize(db: DbSnapshot, isAdmin: boolean): SummaryPayload {
  const games = db.games
    .slice()
    .sort(
      (a, b) =>
        String(b.date).localeCompare(String(a.date)) ||
        String(b.createdAt).localeCompare(String(a.createdAt)),
    )
    .map(enrichGame);

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
    debtSummary: buildDebtSummary(games, db.carry ?? {}),
  };

  if (isAdmin) {
    const paid = games.reduce((s, g) => s + g.summary.paidTotal, 0);
    const expense = Math.max(0, Number(db.totalExpense) || 0);
    payload.kas = { paid, expense, net: paid - expense };
  }

  return payload;
}
