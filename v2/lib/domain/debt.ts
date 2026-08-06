// Hutang & cicilan — port dari server.js (buildDebtSummary + greedy pay/settle).
// Planner murni: balik daftar slot yang harus di-flip jadi paid + carry baru
// + nominal payment yang dicatat. Repo yang eksekusi tulisannya.
//
// Cuma dua sumber tagihan di sini: main biasa (per pemain per game) dan kok
// per partai turnamen (cuma ditagih ke 4 pemain partai itu — beda pasangan
// main beda jumlah partai, jadi tidak adil kalau dirata ke semua peserta).
// Keduanya sama-sama uang kok/kas, jadi cicilan/lunasin-semua otomatis nutup
// keduanya, dari yang paling pas.
//
// Iuran patungan turnamen (fee flat, pool terpisah dari kas kok) SENGAJA
// tidak ikut di sini — itu ditagih & dilunasin sendiri di halaman Turnamen
// (lihat setFeePaidAction/markAllFeesPaidAction), biar Rekap & Belum Bayar
// fokus ke kok aja dan gak nyampur dua pool duit yang beda.

import { gameCost, gameMatchNumbers } from "./game";
import {
  matchKokPerPerson,
  matchParticipants,
  matchPlayedDate,
  matchTitle,
  tournamentMatches,
} from "./tournament";
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
  const matchNumbers = gameMatchNumbers(games);

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
        createdAt: g.createdAt,
        matchNumber: matchNumbers.get(g.id),
      });
    }
  }

  for (const t of tournaments) {
    for (const m of t.matches) {
      if (m.kokTotal <= 0) continue;
      const perPerson = matchKokPerPerson(m);
      if (perPerson <= 0) continue;
      const names = matchParticipants(m);
      for (let i = 0; i < names.length; i++) {
        const name = names[i];
        if (!name || m.kokPaid[i]) continue;
        const e = bucket(name);
        e.owedGross += perPerson;
        e.items.push({
          gameId: `${t.id}::${m.id}`,
          date: matchPlayedDate(t, m),
          name,
          amount: perPerson,
          kokCount: m.koks.length,
          kind: "turnamen_kok",
          label: `${t.name} · ${matchTitle(t, m)}`,
          createdAt: t.createdAt,
        });
      }
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
  /** id game, atau id turnamen kalau kind = "turnamen_kok". */
  id: string;
  /**
   * index pemain di game (0-3), atau slot pemain di partai (0-3, urutan
   * [sisiA.a, sisiA.b, sisiB.a, sisiB.b]) kalau kind = "turnamen_kok".
   */
  index: number;
  /** Cuma kepake buat kind "turnamen_kok" — id partai yang kok-nya ditagih. */
  matchId?: string;
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
    for (const m of tournamentMatches(t)) {
      if (m.kokTotal <= 0) continue;
      const perPerson = matchKokPerPerson(m);
      if (perPerson <= 0) continue;
      const names = matchParticipants(m);
      for (let i = 0; i < names.length; i++) {
        if (names[i] !== name || m.kokPaid[i]) continue;
        refs.push({
          kind: "turnamen_kok",
          id: t.id,
          index: i,
          matchId: m.id,
          date: matchPlayedDate(t, m),
          createdAt: t.createdAt,
          amount: perPerson,
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
  return { kind: r.kind, id: r.id, index: r.index, ...(r.matchId ? { matchId: r.matchId } : {}) };
}

/**
 * Bayar sebagian: greedy lunasin tagihan yang nominalnya paling pas (best-fit)
 * dulu, bukan yang paling lama. Jadi cicilan 10.000 buat orang yang punya
 * utang kok main 3.000 + 2.500 + kok partai turnamen 10.000 bakal nutup kok
 * partai itu pas (diff 0), bukan malah kepecah nyicil kok main 5.500 lalu
 * nyisa ganjil di kok partai. Tiap langkah pilih ref ber-amount ≤ credit
 * dengan selisih paling kecil; kalau seri, yang paling lama menang (byOldest)
 * biar deterministik.
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
