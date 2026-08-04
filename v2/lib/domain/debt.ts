// Hutang & cicilan — port dari server.js (buildDebtSummary + greedy pay/settle).
// Planner murni: balik daftar slot yang harus di-flip jadi paid + carry baru
// + nominal payment yang dicatat. Repo yang eksekusi tulisannya.
//
// Dua sumber tagihan: main biasa (per pemain per game) dan iuran patungan
// turnamen (per peserta per turnamen). Planner memperlakukan keduanya sebagai
// "slot belum bayar" yang sama, jadi cicilan/lunasin-semua otomatis nutup
// dua-duanya, dari yang paling lama.

import { gameCost } from "./game";
import type {
  CarryMap,
  DebtEntry,
  DebtKind,
  EnrichedGame,
  EnrichedTournament,
  StoredGame,
  StoredTournament,
} from "./types";

/** Ringkasan hutang per orang: sisa = max(0, owedGross − carry). */
export function buildDebtSummary(
  games: EnrichedGame[],
  carryMap: CarryMap,
  tournaments: EnrichedTournament[] = [],
): DebtEntry[] {
  const byName: Record<string, Omit<DebtEntry, "carry" | "total">> = {};
  const bucket = (name: string) => {
    if (!byName[name]) byName[name] = { name, owedGross: 0, items: [] };
    return byName[name];
  };

  for (const g of games) {
    for (const p of g.players) {
      if (p.paid || !p.name) continue;
      const e = bucket(p.name);
      e.owedGross += g.cost.perPerson;
      e.items.push({
        gameId: g.id,
        date: g.date,
        name: p.name,
        amount: g.cost.perPerson,
        kokCount: g.cost.kokCount,
        kind: "game",
      });
    }
  }

  for (const t of tournaments) {
    if (t.fee <= 0) continue;
    for (const f of t.fees) {
      if (f.paid || !f.name) continue;
      const e = bucket(f.name);
      e.owedGross += t.fee;
      e.items.push({
        gameId: t.id,
        date: t.date,
        name: f.name,
        amount: t.fee,
        // Kok turnamen itu pool bersama, bukan per orang — jangan dibebankan ke item ini.
        kokCount: 0,
        kind: "turnamen",
        label: t.name,
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
  kind: DebtKind;
  /** id game, atau id turnamen kalau kind = "turnamen". */
  id: string;
  /** index pemain di game (0-3), atau index peserta di daftar iuran turnamen. */
  index: number;
}

export interface SettlePlan {
  touched: TouchedSlot[];
  /** null = hapus entri carry; number = set carry ke nilai ini. */
  carryAfter: number | null;
  /** nominal yang dicatat di ledger payments. */
  paymentAmount: number;
  /** true kalau setelah bayar ini semua tagihannya habis → dicatat sebagai "lunas". */
  clearsDebt: boolean;
}

interface UnpaidRef extends TouchedSlot {
  date: string;
  createdAt: string;
  amount: number;
}

function unpaidRefs(
  games: StoredGame[],
  name: string,
  tournaments: StoredTournament[] = [],
): UnpaidRef[] {
  const refs: UnpaidRef[] = [];
  for (const g of games) {
    const perPerson = gameCost(g).perPerson;
    for (let i = 0; i < g.players.length; i++) {
      if (g.players[i].name === name && !g.players[i].paid) {
        refs.push({
          kind: "game",
          id: g.id,
          index: i,
          date: g.date,
          createdAt: g.createdAt,
          amount: perPerson,
        });
      }
    }
  }
  for (const t of tournaments) {
    if (t.fee <= 0) continue;
    for (let i = 0; i < t.fees.length; i++) {
      if (t.fees[i].name === name && !t.fees[i].paid) {
        refs.push({
          kind: "turnamen",
          id: t.id,
          index: i,
          date: t.date,
          createdAt: t.createdAt,
          amount: t.fee,
        });
      }
    }
  }
  return refs;
}

function byOldest(a: UnpaidRef, b: UnpaidRef): number {
  return (
    String(a.date).localeCompare(String(b.date)) ||
    String(a.createdAt).localeCompare(String(b.createdAt))
  );
}

function slot(r: UnpaidRef): TouchedSlot {
  return { kind: r.kind, id: r.id, index: r.index };
}

/** Bayar sebagian: greedy lunasin tagihan terlama dulu; sisa kredit jadi carry. */
export function planInstallment(
  games: StoredGame[],
  carry: CarryMap,
  name: string,
  amount: number,
  tournaments: StoredTournament[] = [],
): SettlePlan {
  let credit = Math.max(0, Number(carry[name]) || 0) + amount;
  const refs = unpaidRefs(games, name, tournaments).sort(byOldest);
  const touched: TouchedSlot[] = [];
  for (const r of refs) {
    if (credit >= r.amount) {
      touched.push(slot(r));
      credit -= r.amount;
    } else {
      break;
    }
  }
  return {
    touched,
    carryAfter: credit > 0 ? credit : null,
    paymentAmount: amount,
    // Cicilan yang menutup semua tagihan tersisa dihitung lunas (sisa kredit jadi titipan).
    clearsDebt: refs.length > 0 && touched.length === refs.length,
  };
}

/** Lunasin semua tagihan orang sekali klik. Tunai = max(0, total − carry titipan). */
export function planSettle(
  games: StoredGame[],
  carry: CarryMap,
  name: string,
  tournaments: StoredTournament[] = [],
): SettlePlan {
  const carryBefore = Math.max(0, Number(carry[name]) || 0);
  const refs = unpaidRefs(games, name, tournaments).sort(byOldest);
  const settled = refs.reduce((s, r) => s + r.amount, 0);
  return {
    touched: refs.map(slot),
    carryAfter: null,
    paymentAmount: Math.max(0, settled - carryBefore),
    clearsDebt: true,
  };
}
