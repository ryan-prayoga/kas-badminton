// Logika turnamen — bagan single elimination 4/8/16 pasangan. Semua fungsi
// murni; tidak ada I/O. Bentuknya sengaja mirip game.ts biar konsisten:
// harga kok di-snapshot di dalam turnamen, status patungan disimpan per peserta.

import { normalizeName } from "./game";
import type {
  Bracket,
  BracketMatch,
  BracketRound,
  BracketSide,
  EnrichedTournament,
  GameScore,
  MatchScore,
  ScoreFormat,
  StoredTournament,
  TournamentCost,
  TournamentFee,
  TournamentKok,
  TournamentPair,
  TournamentSize,
} from "./types";

export const TOURNAMENT_SIZES: TournamentSize[] = [4, 8, 16];

export function normalizeSize(value: unknown): TournamentSize {
  const n = Number(value);
  return TOURNAMENT_SIZES.includes(n as TournamentSize) ? (n as TournamentSize) : 8;
}

/** Nama pasangan buat ditampilkan: "Fahri / Alan", "Fahri" kalau cuma satu, "" kalau kosong. */
export function pairLabel(pair: TournamentPair | null | undefined): string {
  if (!pair) return "";
  const names = [pair.a, pair.b].map((n) => normalizeName(n)).filter(Boolean);
  return names.join(" / ");
}

export function isPairEmpty(pair: TournamentPair | null | undefined): boolean {
  return !pairLabel(pair);
}

/** Nama peserta unik (urut slot) dari daftar pasangan. */
export function participantNames(pairs: TournamentPair[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of pairs) {
    for (const raw of [p.a, p.b]) {
      const name = normalizeName(raw);
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      out.push(name);
    }
  }
  return out;
}

/**
 * Samakan daftar iuran dengan pemain yang benar-benar ada di bagan:
 * nama baru ditambah (belum bayar), nama yang dihapus dari bagan ikut hilang.
 * Status lunas nama yang tetap ada dipertahankan.
 */
export function syncFees(pairs: TournamentPair[], existing: TournamentFee[]): TournamentFee[] {
  const prev = new Map(existing.map((f) => [f.name.toLowerCase(), f]));
  return participantNames(pairs).map((name) => {
    const old = prev.get(name.toLowerCase());
    if (!old) return { name, paid: false };
    const fee: TournamentFee = { name, paid: Boolean(old.paid) };
    if (fee.paid && old.paidAt) fee.paidAt = old.paidAt;
    if (fee.paid && old.paidBy) fee.paidBy = old.paidBy;
    return fee;
  });
}

function normalizePairs(raw: unknown, size: TournamentSize, genId?: () => string): TournamentPair[] {
  const list = Array.isArray(raw) ? raw : [];
  const bySlot = new Map<number, TournamentPair>();
  for (let i = 0; i < list.length; i++) {
    const p = list[i] as Partial<TournamentPair> | null;
    if (!p || typeof p !== "object") continue;
    const slot = Number.isInteger(p.slot) ? Number(p.slot) : i;
    if (slot < 0 || slot >= size || bySlot.has(slot)) continue;
    bySlot.set(slot, {
      id: String(p.id || (genId ? genId() : `slot-${slot}`)),
      slot,
      a: normalizeName(p.a).slice(0, 60),
      b: normalizeName(p.b).slice(0, 60),
    });
  }
  return Array.from({ length: size }, (_, slot) => {
    const found = bySlot.get(slot);
    if (found) return found;
    return { id: genId ? genId() : `slot-${slot}`, slot, a: "", b: "" };
  });
}

export const SCORE_FORMATS: { value: ScoreFormat; label: string; hint: string }[] = [
  { value: "single", label: "Sampai 30", hint: "1 game, biasa" },
  { value: "bo3", label: "Rally 21", hint: "best of 3 game" },
];

export function normalizeScoreFormat(value: unknown): ScoreFormat {
  return value === "bo3" ? "bo3" : "single";
}

/** Jumlah game maksimal per format. */
export function maxGames(format: ScoreFormat): number {
  return format === "bo3" ? 3 : 1;
}

function normalizeGame(raw: unknown): GameScore | null {
  if (!raw || typeof raw !== "object") return null;
  const g = raw as Partial<GameScore>;
  const a = Math.max(0, Math.min(99, Math.round(Number(g.a) || 0)));
  const b = Math.max(0, Math.min(99, Math.round(Number(g.b) || 0)));
  if (a === 0 && b === 0) return null; // 0-0 = game belum dimainkan
  return { a, b };
}

/**
 * Normalisasi satu skor pertandingan. Menerima juga bentuk lama `{a,b}`
 * (sebelum ada format) — diperlakukan sebagai satu game "sampai 30".
 */
export function normalizeMatchScore(raw: unknown): MatchScore | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Partial<MatchScore> & Partial<GameScore>;

  if (!Array.isArray(obj.games)) {
    const legacy = normalizeGame(obj);
    return legacy ? { format: "single", games: [legacy] } : null;
  }

  const format = normalizeScoreFormat(obj.format);
  const games = obj.games
    .map(normalizeGame)
    .filter((g): g is GameScore => g !== null)
    .slice(0, maxGames(format));
  return games.length ? { format, games } : null;
}

function normalizeResults(raw: unknown): Record<string, MatchScore> {
  const out: Record<string, MatchScore> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!MATCH_ID_RE.test(id)) continue;
    const score = normalizeMatchScore(value);
    if (score) out[id] = score;
  }
  return out;
}

/** Berapa game dimenangkan tiap sisi. Game seri tidak dihitung ke siapa pun. */
export function gamesWon(score: MatchScore | null): { a: number; b: number } {
  const out = { a: 0, b: 0 };
  for (const g of score?.games ?? []) {
    if (g.a > g.b) out.a += 1;
    else if (g.b > g.a) out.b += 1;
  }
  return out;
}

/** Berapa game yang harus dimenangkan buat lolos. */
function gamesToWin(format: ScoreFormat): number {
  return format === "bo3" ? 2 : 1;
}

/** "21-18 · 19-21 · 21-15" — dipakai buat share/ringkasan teks. */
export function scoreLine(score: MatchScore | null): string {
  if (!score?.games.length) return "";
  return score.games.map((g) => `${g.a}-${g.b}`).join(" · ");
}

const MATCH_ID_RE = /^r\d+-\d+$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Daftar tanggal turnamen, dari mulai sampai selesai. */
export function tournamentDays(date: string, endDate: string | null): string[] {
  if (!endDate || endDate <= date) return date ? [date] : [];
  const days: string[] = [];
  // Pakai UTC supaya penambahan hari tidak kena geser zona waktu saat diformat balik.
  const cur = new Date(`${date}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  // Batasi 60 hari — turnamen yang lebih panjang dari itu hampir pasti salah input.
  while (cur <= end && days.length < 60) {
    days.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return days;
}

/** Jepit tanggal ke dalam rentang turnamen; di luar rentang → tanggal mulai. */
export function clampToTournament(value: unknown, date: string, endDate: string | null): string {
  const v = String(value ?? "");
  if (!ISO_DATE_RE.test(v)) return date;
  const last = endDate && endDate > date ? endDate : date;
  if (v < date) return date;
  if (v > last) return last;
  return v;
}

/** matchId yang tidak dikenal dianggap kok umum, biar bagan tidak menyembunyikan kok. */
function normalizeKoks(
  raw: unknown,
  size: TournamentSize,
  date: string,
  endDate: string | null,
): TournamentKok[] {
  if (!Array.isArray(raw)) return [];
  const total = roundCount(size);
  return raw.map((k) => {
    const kok = k as TournamentKok;
    const id = String(kok?.matchId ?? "");
    let matchId: string | null = null;
    const m = MATCH_ID_RE.test(id) ? /^r(\d+)-(\d+)$/.exec(id) : null;
    if (m) {
      const round = Number(m[1]);
      const index = Number(m[2]);
      if (round >= 0 && round < total && index >= 0 && index < size / 2 ** (round + 1)) {
        matchId = id;
      }
    }
    // Kok lama tanpa tanggal (atau di luar rentang) jatuh ke hari pertama turnamen.
    return { ...kok, matchId, date: clampToTournament(kok?.date, date, endDate) };
  });
}

export function normalizeStoredTournament<T extends Partial<StoredTournament>>(
  t: T,
  genId?: () => string,
): StoredTournament {
  const size = normalizeSize(t.size);
  const pairs = normalizePairs(t.pairs, size, genId);
  const date = t.date ?? "";
  // Tanggal selesai sebelum tanggal mulai tidak masuk akal — anggap sehari saja.
  const rawEnd = t.endDate ? String(t.endDate) : "";
  const endDate = rawEnd && rawEnd > date ? rawEnd : null;
  return {
    id: t.id ?? "",
    name: normalizeName(t.name).slice(0, 80) || "Turnamen",
    date,
    endDate,
    size,
    fee: Math.max(0, Math.round(Number(t.fee) || 0)),
    scoreFormat: normalizeScoreFormat(t.scoreFormat),
    pairs,
    results: normalizeResults(t.results),
    koks: normalizeKoks(t.koks, size, date, endDate),
    fees: syncFees(pairs, Array.isArray(t.fees) ? (t.fees as TournamentFee[]) : []),
    notes: t.notes ?? null,
    recordedBy: t.recordedBy ?? null,
    createdAt: t.createdAt ?? "",
    updatedAt: t.updatedAt ?? "",
  };
}

// --- Bagan ---

export function matchId(round: number, index: number): string {
  return `r${round}-${index}`;
}

/** Jumlah babak: 4 pasangan → 2, 8 → 3, 16 → 4. */
export function roundCount(size: TournamentSize): number {
  return Math.round(Math.log2(size));
}

/** Label babak dihitung dari sisa babak menuju final. */
export function roundLabel(round: number, total: number): string {
  const remaining = total - round;
  if (remaining <= 1) return "Final";
  if (remaining === 2) return "Semifinal";
  if (remaining === 3) return "Perempat Final";
  return `Babak ${2 ** remaining} Besar`;
}

function side(pair: TournamentPair | null, from: string | null): BracketSide {
  return { pair, bye: isPairEmpty(pair), from };
}

/**
 * Pemenang satu pertandingan.
 * - Satu sisi BYE → sisi lain otomatis lolos (tanpa skor).
 * - Dua-duanya BYE → belum ada siapa-siapa.
 * - `single`: menang 1 game. `bo3`: menang 2 game.
 * - Belum cukup game / seri → belum ada pemenang.
 */
function resolveWinner(
  a: BracketSide,
  b: BracketSide,
  score: MatchScore | null,
): { winner: "a" | "b" | null; autoWin: boolean } {
  if (a.bye && b.bye) return { winner: null, autoWin: false };
  // Sisi lawan BYE tapi belum ada isinya (masih nunggu babak sebelumnya) → belum lolos siapa-siapa.
  if (a.bye) return b.pair ? { winner: "b", autoWin: true } : { winner: null, autoWin: false };
  if (b.bye) return a.pair ? { winner: "a", autoWin: true } : { winner: null, autoWin: false };
  // Skor cuma sah kalau dua-duanya sudah terisi.
  if (!a.pair || !b.pair || !score) return { winner: null, autoWin: false };
  const need = gamesToWin(score.format);
  const won = gamesWon(score);
  if (won.a >= need && won.a > won.b) return { winner: "a", autoWin: false };
  if (won.b >= need && won.b > won.a) return { winner: "b", autoWin: false };
  return { winner: null, autoWin: false };
}

function winnerPair(m: BracketMatch): TournamentPair | null {
  if (!m.winner) return null;
  return (m.winner === "a" ? m.a.pair : m.b.pair) ?? null;
}

/** Harga satu kok = pricePerPerson × 4, sama seperti gameCost().total. */
export function koksTotal(koks: TournamentKok[]): number {
  return koks.reduce((s, k) => s + (Number(k.pricePerPerson) || 0) * 4, 0);
}

/** Kelompokkan kok per partai; kunci `null` = kok umum turnamen. */
export function koksByMatch(koks: TournamentKok[]): Map<string | null, TournamentKok[]> {
  const map = new Map<string | null, TournamentKok[]>();
  for (const k of koks) {
    const key = k.matchId ?? null;
    const list = map.get(key);
    if (list) list.push(k);
    else map.set(key, [k]);
  }
  return map;
}

/** Kelompokkan kok per tanggal pemakaian, urut tanggal. */
export function koksByDate(koks: TournamentKok[]): { date: string; koks: TournamentKok[] }[] {
  const map = new Map<string, TournamentKok[]>();
  for (const k of koks) {
    const list = map.get(k.date);
    if (list) list.push(k);
    else map.set(k.date, [k]);
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, list]) => ({ date, koks: list }));
}

export function buildBracket(
  t: Pick<StoredTournament, "size" | "pairs" | "results"> & { koks?: TournamentKok[] },
): Bracket {
  const size = normalizeSize(t.size);
  const total = roundCount(size);
  const pairs = t.pairs;
  const byMatch = koksByMatch(t.koks ?? []);
  const rounds: BracketRound[] = [];
  let prev: BracketMatch[] = [];

  for (let round = 0; round < total; round++) {
    const count = size / 2 ** (round + 1);
    const matches: BracketMatch[] = [];
    for (let index = 0; index < count; index++) {
      const id = matchId(round, index);
      let a: BracketSide;
      let b: BracketSide;
      if (round === 0) {
        a = side(pairs[index * 2] ?? null, null);
        b = side(pairs[index * 2 + 1] ?? null, null);
      } else {
        const srcA = prev[index * 2];
        const srcB = prev[index * 2 + 1];
        // Cabang yang seluruh isinya BYE tetap BYE — pemenang di atasnya lolos otomatis.
        a = { pair: winnerPair(srcA), bye: srcA.a.bye && srcA.b.bye, from: srcA.id };
        b = { pair: winnerPair(srcB), bye: srcB.a.bye && srcB.b.bye, from: srcB.id };
      }
      const score = t.results[id] ?? null;
      const { winner, autoWin } = resolveWinner(a, b, score);
      const koks = byMatch.get(id) ?? [];
      matches.push({
        id,
        round,
        index,
        a,
        b,
        score,
        gamesWon: gamesWon(score),
        winner,
        autoWin,
        koks,
        kokTotal: koksTotal(koks),
      });
    }
    rounds.push({ round, label: roundLabel(round, total), matches });
    prev = matches;
  }

  const final = prev[0] ?? null;
  return { rounds, champion: final ? winnerPair(final) : null };
}

// --- Biaya & iuran ---

export function tournamentCost(t: Pick<StoredTournament, "koks" | "fee" | "fees">): TournamentCost {
  const koks = Array.isArray(t.koks) ? t.koks : [];
  const fee = Math.max(0, Math.round(Number(t.fee) || 0));
  const fees = Array.isArray(t.fees) ? t.fees : [];
  const paidCount = fees.filter((f) => f.paid).length;
  return {
    kokCount: koks.length,
    kokTotal: koksTotal(koks),
    looseKoks: koks.filter((k) => !k.matchId),
    participants: fees.length,
    feeTotal: fee * fees.length,
    feePaid: fee * paidCount,
    feeUnpaid: fee * (fees.length - paidCount),
    paidCount,
    unpaidCount: fees.length - paidCount,
  };
}

export function enrichTournament(t: Partial<StoredTournament>): EnrichedTournament {
  const stored = normalizeStoredTournament(t);
  return { ...stored, bracket: buildBracket(stored), cost: tournamentCost(stored) };
}

/** "Semifinal · Partai 2" — dipakai di rincian kok & judul dialog pertandingan. */
export function matchTitle(round: number, index: number, size: TournamentSize): string {
  const total = roundCount(size);
  const count = size / 2 ** (round + 1);
  const label = roundLabel(round, total);
  return count > 1 ? `${label} · Partai ${index + 1}` : label;
}

/** Saran iuran per orang biar nutup biaya kok — dibulatkan ke atas per 500. */
export function suggestFee(kokTotal: number, participants: number): number {
  if (!(participants > 0) || !(kokTotal > 0)) return 0;
  return Math.ceil(kokTotal / participants / 500) * 500;
}
