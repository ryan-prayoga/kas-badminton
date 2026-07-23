// loadSnapshot — port loadDb() server.js, tapi read-only (semua tulisan per-row di modul lain).

import { prisma } from "@/lib/db";
import type { CarryMap, DbSnapshot } from "@/lib/domain/types";
import { rowToGame, rowToKokType } from "./mappers";

export async function loadSnapshot(): Promise<DbSnapshot> {
  const [settingsRow, playerRows, gameRows, typeRows, carryRows, expenseAgg] = await Promise.all([
    prisma.settings.findUnique({ where: { id: 1 } }),
    prisma.players.findMany({ orderBy: { name: "asc" } }),
    prisma.games.findMany(),
    prisma.kok_types.findMany(),
    prisma.player_carry.findMany(),
    prisma.expenses.aggregate({ _sum: { amount: true } }),
  ]);

  const carry: CarryMap = {};
  for (const r of carryRows) {
    const c = Math.max(0, Math.round(Number(r.carry) || 0));
    if (c > 0) carry[r.name] = c;
  }

  const kokTypes = typeRows
    .map(rowToKokType)
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

  return {
    settings: {
      defaultPricePerPerson: Number(settingsRow?.default_price_per_person) || 3000,
      merchantQris: settingsRow?.merchant_qris || "",
    },
    players: playerRows.map((r) => ({ name: r.name, photo: r.photo || null })),
    games: gameRows.map(rowToGame),
    kokTypes,
    carry,
    totalExpense: Number(expenseAgg._sum.amount) || 0,
  };
}
