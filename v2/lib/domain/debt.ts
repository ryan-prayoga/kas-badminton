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
        // Kok turnamen itu pool bersama, bukan per orang — jadi ini cuma info jumlah kok
        // yang sudah kepakai di turnamen ini, bukan basis pembagian nominal `amount`.
        kokCount: t.cost.kokCount,
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

/**
 * Bayar sebagian: greedy lunasin tagihan yang nominalnya paling pas (best-fit)
 * dulu, bukan yang paling lama. Jadi cicilan 10.000 buat orang yang punya
 * utang kok 3.000 + 2.500 + iuran patungan 10.000 bakal nutup patungan itu
 * pas (diff 0), bukan malah kepecah nyicil kok 5.500 lalu nyisa ganjil di
 * patungan. Tiap langkah pilih ref ber-amount ≤ credit dengan selisih paling
 * kecil; kalau seri, yang paling lama menang (byOldest) biar deterministik.
 */
export function planInstallment(
  games: StoredGame[],
  carry: CarryMap,
  name: string,
  amount: number,
  tournaments: StoredTournament[] = [],
): SettlePlan {
  let credit = Math.max(0, Number(carry[name]) || 0) + amount;
  const refs = unpaidRefs(games, name, tournaments);
  const remaining = [...refs];
  const touched: TouchedSlot[] = [];
  while (true) {
    let bestIdx = -1;
    for (let i = 0; i < remaining.length; i++) {
      const r = remaining[i];
      if (r.amount > credit) continue;
      if (bestIdx === -1) {
        bestIdx = i;
        continue;
      }
      const best = remaining[bestIdx];
      const diff = credit - r.amount;
      const bestDiff = credit - best.amount;
      if (diff < bestDiff || (diff === bestDiff && byOldest(r, best) < 0)) {
        bestIdx = i;
      }
    }
    if (bestIdx === -1) break;
    const r = remaining[bestIdx];
    touched.push(slot(r));
    credit -= r.amount;
    remaining.splice(bestIdx, 1);
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
