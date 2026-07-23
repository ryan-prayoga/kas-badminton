// Hutang & cicilan — port dari server.js (buildDebtSummary + greedy pay/settle).
// Planner murni: balik daftar slot pemain yang harus di-flip jadi paid + carry baru
// + nominal payment yang dicatat. Repo yang eksekusi tulisannya.

import { gameCost } from "./game";
import type { CarryMap, DebtEntry, EnrichedGame, StoredGame } from "./types";

/** Ringkasan hutang per orang: sisa = max(0, owedGross − carry). */
export function buildDebtSummary(games: EnrichedGame[], carryMap: CarryMap): DebtEntry[] {
  const byName: Record<string, Omit<DebtEntry, "carry" | "total">> = {};
  for (const g of games) {
    for (const p of g.players) {
      if (p.paid || !p.name) continue;
      if (!byName[p.name]) byName[p.name] = { name: p.name, owedGross: 0, items: [] };
      byName[p.name].owedGross += g.cost.perPerson;
      byName[p.name].items.push({
        gameId: g.id,
        date: g.date,
        name: p.name,
        amount: g.cost.perPerson,
        kokCount: g.cost.kokCount,
      });
    }
  }
  return Object.values(byName)
    .map((e) => {
      const carry = Math.max(0, Number(carryMap?.[e.name]) || 0);
      return { ...e, carry, total: Math.max(0, e.owedGross - carry) };
    })
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "id"));
}

export interface TouchedSlot {
  gameId: string;
  index: number;
}

export interface SettlePlan {
  touched: TouchedSlot[];
  /** null = hapus entri carry; number = set carry ke nilai ini. */
  carryAfter: number | null;
  /** nominal yang dicatat di ledger payments. */
  paymentAmount: number;
}

function unpaidRefs(games: StoredGame[], name: string) {
  const refs: { gameId: string; index: number; date: string; createdAt: string; perPerson: number }[] =
    [];
  for (const g of games) {
    const perPerson = gameCost(g).perPerson;
    for (let i = 0; i < g.players.length; i++) {
      if (g.players[i].name === name && !g.players[i].paid) {
        refs.push({ gameId: g.id, index: i, date: g.date, createdAt: g.createdAt, perPerson });
      }
    }
  }
  return refs;
}

/** Bayar sebagian: greedy lunasin game terlama dulu; sisa kredit jadi carry. */
export function planInstallment(
  games: StoredGame[],
  carry: CarryMap,
  name: string,
  amount: number,
): SettlePlan {
  let credit = Math.max(0, Number(carry[name]) || 0) + amount;
  const refs = unpaidRefs(games, name).sort(
    (a, b) =>
      String(a.date).localeCompare(String(b.date)) ||
      String(a.createdAt).localeCompare(String(b.createdAt)),
  );
  const touched: TouchedSlot[] = [];
  for (const r of refs) {
    if (credit >= r.perPerson) {
      touched.push({ gameId: r.gameId, index: r.index });
      credit -= r.perPerson;
    } else {
      break;
    }
  }
  return {
    touched,
    carryAfter: credit > 0 ? credit : null,
    paymentAmount: amount,
  };
}

/** Lunasin semua tagihan orang sekali klik. Tunai = max(0, total − carry titipan). */
export function planSettle(games: StoredGame[], carry: CarryMap, name: string): SettlePlan {
  const carryBefore = Math.max(0, Number(carry[name]) || 0);
  let settled = 0;
  const touched: TouchedSlot[] = [];
  for (const g of games) {
    const perPerson = gameCost(g).perPerson;
    for (let i = 0; i < g.players.length; i++) {
      if (g.players[i].name === name && !g.players[i].paid) {
        touched.push({ gameId: g.id, index: i });
        settled += perPerson;
      }
    }
  }
  return {
    touched,
    carryAfter: null,
    paymentAmount: Math.max(0, settled - carryBefore),
  };
}
