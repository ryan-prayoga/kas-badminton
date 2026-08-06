// Hutang & cicilan — port dari server.js (buildDebtSummary + greedy pay/settle).
// Planner murni: balik daftar slot yang harus di-flip jadi paid + carry baru
// + nominal payment yang dicatat. Repo yang eksekusi tulisannya.
//
// Tiga sumber tagihan: main biasa (per pemain per game), iuran patungan
// turnamen (flat, rata ke semua peserta), dan kok per partai turnamen (cuma
// ditagih ke 4 pemain partai itu — beda pasangan main beda jumlah partai,
// jadi tidak adil kalau dirata ke semua peserta lewat fee). Planner
// memperlakukan ketiganya sebagai "slot belum bayar" yang sama, jadi
// cicilan/lunasin-semua otomatis nutup semuanya, dari yang paling pas.

import { gameCost } from "./game";
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

/**
 * Partai ke berapa tiap game di hari itu — urut dari yang paling dulu dicatat
 * (createdAt paling lama = Partai 1), biar "Main" di rekap tidak ambigu
 * kalau orang yang sama main lebih dari sekali di hari yang sama.
 */
function gameMatchNumbers(games: EnrichedGame[]): Map<string, number> {
  const byDate = new Map<string, EnrichedGame[]>();
  for (const g of games) {
    const list = byDate.get(g.date);
    if (list) list.push(g);
    else byDate.set(g.date, [g]);
  }
  const out = new Map<string, number>();
  for (const list of byDate.values()) {
    const sorted = [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    sorted.forEach((g, i) => out.set(g.id, i + 1));
  }
  return out;
}

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
        // Iuran flat ini bukan basis kok — kok per partai punya item sendiri di bawah.
        kokCount: 0,
        kind: "turnamen",
        label: t.name,
        createdAt: t.createdAt,
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
  /** id game, atau id turnamen kalau kind = "turnamen"/"turnamen_kok". */
  id: string;
  /**
   * index pemain di game (0-3), index peserta di daftar iuran turnamen, atau
   * slot pemain di partai (0-3, urutan [sisiA.a, sisiA.b, sisiB.a, sisiB.b])
   * kalau kind = "turnamen_kok".
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
    if (t.fee > 0) {
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
