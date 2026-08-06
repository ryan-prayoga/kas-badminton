// Logika turnamen — sistem gugur (knockout) atau semua lawan semua (round robin).
// Semua fungsi murni; tidak ada I/O. Bentuknya sengaja mirip game.ts biar
// konsisten: harga kok di-snapshot di dalam turnamen, status patungan per peserta.

import { normalizeName } from "./game";
import type {
  Bracket,
  BracketMatch,
  BracketRound,
  BracketSide,
  EnrichedTournament,
  GameScore,
  MatchScore,
  RoundRobin,
  ScoreFormat,
  StandingRow,
  StoredTournament,
  TournamentCost,
  TournamentFee,
  TournamentFormat,
  TournamentKok,
  TournamentPair,
} from "./types";

export const MIN_PAIRS = 2;
export const MAX_PAIRS = 32;

export const TOURNAMENT_FORMATS: { value: TournamentFormat; label: string; hint: string }[] = [
  { value: "knockout", label: "Sistem gugur", hint: "kalah sekali, habis" },
  { value: "round_robin", label: "Semua lawan semua", hint: "juara dari klasemen" },
];

export function normalizeFormat(value: unknown): TournamentFormat {
  return value === "round_robin" ? "round_robin" : "knockout";
}

/** Jumlah pasangan, dijepit ke 2–32. */
export function normalizeSize(value: unknown): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return 8;
  return Math.max(MIN_PAIRS, Math.min(MAX_PAIRS, n));
}

/**
 * Ukuran bagan knockout = pangkat 2 terdekat ke atas dari jumlah pasangan.
 * 14 pasangan → bagan 16, dua slot sisanya jadi BYE.
 */
export function bracketSize(size: number): number {
  return 2 ** Math.ceil(Math.log2(Math.max(MIN_PAIRS, size)));
}

/** Jumlah partai round robin: setiap pasangan ketemu semua pasangan lain sekali. */
export function roundRobinMatchCount(size: number): number {
  return (size * (size - 1)) / 2;
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

function normalizePairs(raw: unknown, size: number, genId?: () => string): TournamentPair[] {
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

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
  const playedAt = ISO_DATE_RE.test(String(obj.playedAt ?? "")) ? String(obj.playedAt) : undefined;

  if (!Array.isArray(obj.games)) {
    const legacy = normalizeGame(obj);
    return legacy ? { format: "single", games: [legacy], ...(playedAt ? { playedAt } : {}) } : null;
  }

  const format = normalizeScoreFormat(obj.format);
  const games = obj.games
    .map(normalizeGame)
    .filter((g): g is GameScore => g !== null)
    .slice(0, maxGames(format));
  return games.length ? { format, games, ...(playedAt ? { playedAt } : {}) } : null;
}

function normalizeResults(raw: unknown, validIds: Set<string>): Record<string, MatchScore> {
  const out: Record<string, MatchScore> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!validIds.has(id)) continue;
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

/** Id partai knockout: babak + urutan di babak itu. */
export function matchId(round: number, index: number): string {
  return `r${round}-${index}`;
}

/** Id partai round robin: pasangan slot i lawan slot j (i < j). */
export function rrMatchId(i: number, j: number): string {
  const [lo, hi] = i < j ? [i, j] : [j, i];
  return `rr${lo}-${hi}`;
}

/**
 * Semua id partai yang sah untuk satu turnamen. Dipakai buat memvalidasi
 * skor & kok — id di luar daftar ini dibuang / dianggap kok umum, jadi data
 * lama tetap terbaca walau ukuran atau formatnya diubah.
 */
export function matchIdSet(format: TournamentFormat, size: number): Set<string> {
  const ids = new Set<string>();
  if (format === "round_robin") {
    for (let i = 0; i < size; i++) {
      for (let j = i + 1; j < size; j++) ids.add(rrMatchId(i, j));
    }
    return ids;
  }
  const slots = bracketSize(size);
  const rounds = roundCount(slots);
  for (let round = 0; round < rounds; round++) {
    const count = slots / 2 ** (round + 1);
    for (let index = 0; index < count; index++) ids.add(matchId(round, index));
  }
  return ids;
}

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

/** matchId yang tidak dikenal dianggap kok umum, biar kok tidak hilang dari total. */
function normalizeKoks(
  raw: unknown,
  validIds: Set<string>,
  date: string,
  endDate: string | null,
): TournamentKok[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((k) => {
    const kok = k as TournamentKok;
    const id = String(kok?.matchId ?? "");
    // Kok lama tanpa tanggal (atau di luar rentang) jatuh ke hari pertama turnamen.
    return {
      ...kok,
      matchId: validIds.has(id) ? id : null,
      date: clampToTournament(kok?.date, date, endDate),
    };
  });
}

/** Selalu 4 boolean — [sisiA.a, sisiA.b, sisiB.a, sisiB.b]. Kurang/lebih dijepit, bukan-boolean dibuang jadi false. */
function normalizeKokPaid(raw: unknown): boolean[] {
  const arr = Array.isArray(raw) ? raw : [];
  return [0, 1, 2, 3].map((i) => Boolean(arr[i]));
}

/** matchId yang tidak dikenal dibuang — partai itu sudah tidak ada lagi di bagan. */
function normalizeMatchKokPaid(raw: unknown, validIds: Set<string>): Record<string, boolean[]> {
  const out: Record<string, boolean[]> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!validIds.has(id)) continue;
    out[id] = normalizeKokPaid(value);
  }
  return out;
}

export function normalizeStoredTournament<T extends Partial<StoredTournament>>(
  t: T,
  genId?: () => string,
): StoredTournament {
  const size = normalizeSize(t.size);
  const format = normalizeFormat(t.format);
  const pairs = normalizePairs(t.pairs, size, genId);
  const date = t.date ?? "";
  // Tanggal selesai sebelum tanggal mulai tidak masuk akal — anggap sehari saja.
  const rawEnd = t.endDate ? String(t.endDate) : "";
  const endDate = rawEnd && rawEnd > date ? rawEnd : null;
  const validIds = matchIdSet(format, size);
  return {
    id: t.id ?? "",
    name: normalizeName(t.name).slice(0, 80) || "Turnamen",
    date,
    endDate,
    format,
    size,
    fee: Math.max(0, Math.round(Number(t.fee) || 0)),
    scoreFormat: normalizeScoreFormat(t.scoreFormat),
    pairs,
    results: normalizeResults(t.results, validIds),
    koks: normalizeKoks(t.koks, validIds, date, endDate),
    fees: syncFees(pairs, Array.isArray(t.fees) ? (t.fees as TournamentFee[]) : []),
    matchKokPaid: normalizeMatchKokPaid(t.matchKokPaid, validIds),
    notes: t.notes ?? null,
    recordedBy: t.recordedBy ?? null,
    createdAt: t.createdAt ?? "",
    updatedAt: t.updatedAt ?? "",
  };
}

// --- Bagan ---

/** Jumlah babak dari ukuran bagan: 4 slot → 2 babak, 8 → 3, 16 → 4. */
export function roundCount(slots: number): number {
  return Math.round(Math.log2(Math.max(MIN_PAIRS, slots)));
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

/**
 * Tempatkan pasangan ke slot bagan. Jumlah yang bukan pangkat 2 disisipi BYE,
 * dan BYE-nya disebar satu per partai (bukan menumpuk di ujung) — kalau
 * menumpuk, ada partai yang dua sisinya kosong dan cabangnya jadi mubazir.
 */
export function seedSlots(pairs: TournamentPair[], size: number): (TournamentPair | null)[] {
  const slots = bracketSize(size);
  const matches = slots / 2;
  const byes = slots - size;
  // Partai ber-BYE diambil dari yang paling belakang; sisi kanannya dikosongkan.
  const firstByeMatch = matches - byes;
  const out: (TournamentPair | null)[] = [];
  let next = 0;
  for (let m = 0; m < matches; m++) {
    out.push(pairs[next++] ?? null);
    out.push(m >= firstByeMatch ? null : (pairs[next++] ?? null));
  }
  return out;
}

export function buildBracket(
  t: Pick<StoredTournament, "size" | "pairs" | "results"> & {
    koks?: TournamentKok[];
    matchKokPaid?: Record<string, boolean[]>;
  },
): Bracket {
  const size = normalizeSize(t.size);
  const slots = bracketSize(size);
  const total = roundCount(slots);
  const pairs = seedSlots(t.pairs, size);
  const byMatch = koksByMatch(t.koks ?? []);
  const kokPaidMap = t.matchKokPaid ?? {};
  const rounds: BracketRound[] = [];
  let prev: BracketMatch[] = [];

  for (let round = 0; round < total; round++) {
    const count = slots / 2 ** (round + 1);
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
        kokPaid: normalizeKokPaid(kokPaidMap[id]),
      });
    }
    rounds.push({ round, label: roundLabel(round, total), matches });
    prev = matches;
  }

  const final = prev[0] ?? null;
  return { rounds, champion: final ? winnerPair(final) : null };
}

// --- Round robin ---

/** Total poin skor tiap sisi dari semua game — dipakai buat selisih di klasemen. */
function pointsOf(score: MatchScore | null): { a: number; b: number } {
  const out = { a: 0, b: 0 };
  for (const g of score?.games ?? []) {
    out.a += g.a;
    out.b += g.b;
  }
  return out;
}

/**
 * Semua lawan semua, sekali putaran. Klasemen diurutkan: menang terbanyak,
 * lalu selisih poin, lalu poin dibuat, terakhir nama — biar urutannya stabil.
 */
export function buildRoundRobin(
  t: Pick<StoredTournament, "size" | "pairs" | "results"> & {
    koks?: TournamentKok[];
    matchKokPaid?: Record<string, boolean[]>;
  },
): RoundRobin {
  const size = normalizeSize(t.size);
  const byMatch = koksByMatch(t.koks ?? []);
  const kokPaidMap = t.matchKokPaid ?? {};
  const matches: BracketMatch[] = [];

  const rows = new Map<string, StandingRow>();
  const rowFor = (pair: TournamentPair): StandingRow => {
    const found = rows.get(pair.id);
    if (found) return found;
    const row: StandingRow = {
      pair,
      played: 0,
      won: 0,
      lost: 0,
      gamesFor: 0,
      gamesAgainst: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      diff: 0,
    };
    rows.set(pair.id, row);
    return row;
  };
  // Pasangan kosong tidak ikut klasemen — di round robin tidak ada BYE.
  for (const p of t.pairs) if (!isPairEmpty(p)) rowFor(p);

  let index = 0;
  for (let i = 0; i < size; i++) {
    for (let j = i + 1; j < size; j++) {
      const pairA = t.pairs[i] ?? null;
      const pairB = t.pairs[j] ?? null;
      const id = rrMatchId(i, j);
      const a = side(pairA, null);
      const b = side(pairB, null);
      const score = t.results[id] ?? null;
      // Tidak ada BYE di round robin: slot kosong berarti partainya tidak ada,
      // bukan lawannya menang otomatis.
      const bothReal = !a.bye && !b.bye;
      const winner = bothReal ? resolveWinner(a, b, score).winner : null;
      const koks = byMatch.get(id) ?? [];
      matches.push({
        id,
        round: 0,
        index: index++,
        a,
        b,
        score,
        gamesWon: gamesWon(score),
        winner,
        autoWin: false,
        koks,
        kokTotal: koksTotal(koks),
        kokPaid: normalizeKokPaid(kokPaidMap[id]),
      });

      if (!winner || !pairA || !pairB) continue;
      const won = gamesWon(score);
      const pts = pointsOf(score);
      const rowA = rowFor(pairA);
      const rowB = rowFor(pairB);
      rowA.played += 1;
      rowB.played += 1;
      rowA.gamesFor += won.a;
      rowA.gamesAgainst += won.b;
      rowB.gamesFor += won.b;
      rowB.gamesAgainst += won.a;
      rowA.pointsFor += pts.a;
      rowA.pointsAgainst += pts.b;
      rowB.pointsFor += pts.b;
      rowB.pointsAgainst += pts.a;
      if (winner === "a") {
        rowA.won += 1;
        rowB.lost += 1;
      } else {
        rowB.won += 1;
        rowA.lost += 1;
      }
    }
  }

  for (const row of rows.values()) row.diff = row.pointsFor - row.pointsAgainst;

  const standings = [...rows.values()].sort(
    (x, y) =>
      y.won - x.won ||
      y.diff - x.diff ||
      y.pointsFor - x.pointsFor ||
      pairLabel(x.pair).localeCompare(pairLabel(y.pair), "id"),
  );

  // Partai yang dua sisinya kosong tidak mungkin dimainkan — jangan dihitung.
  const playable = matches.filter((m) => m.a.pair && m.b.pair && !m.a.bye && !m.b.bye);
  const played = playable.filter((m) => m.winner !== null).length;
  const done = playable.length > 0 && played === playable.length;
  const top = standings[0];
  // Juara cuma sah kalau semua partai sudah main dan peringkat 1 tidak seri menang-nya.
  const champion =
    done && top && (standings.length === 1 || top.won > standings[1].won) ? top.pair : null;

  return { matches, standings, champion, playedCount: played, totalCount: playable.length };
}

// --- Biaya & iuran ---

export function tournamentCost(
  t: Pick<StoredTournament, "koks" | "fee" | "fees">,
): Omit<TournamentCost, "kokPaid"> {
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

/** Rupiah kok per-partai yang udah lunas, dijumlah lintas partai — beda tagihan
 * dari fee (lihat tournamentCost). Butuh matches yang udah di-resolve (kokPaid
 * per slot), jadi baru bisa dihitung setelah buildBracket/buildRoundRobin. */
function matchesKokPaid(matches: BracketMatch[]): number {
  let total = 0;
  for (const m of matches) {
    if (m.kokTotal <= 0) continue;
    const perPerson = matchKokPerPerson(m);
    if (perPerson <= 0) continue;
    const names = matchParticipants(m);
    for (let i = 0; i < names.length; i++) {
      if (names[i] && m.kokPaid[i]) total += perPerson;
    }
  }
  return total;
}

export function enrichTournament(t: Partial<StoredTournament>): EnrichedTournament {
  const stored = normalizeStoredTournament(t);
  const baseCost = tournamentCost(stored);

  if (stored.format === "round_robin") {
    const roundRobin = buildRoundRobin(stored);
    return {
      ...stored,
      bracket: null,
      roundRobin,
      matches: roundRobin.matches,
      champion: roundRobin.champion,
      playedCount: roundRobin.playedCount,
      totalCount: roundRobin.totalCount,
      finished: roundRobin.totalCount > 0 && roundRobin.playedCount === roundRobin.totalCount,
      cost: { ...baseCost, kokPaid: matchesKokPaid(roundRobin.matches) },
    };
  }

  const bracket = buildBracket(stored);
  const matches = bracket.rounds.flatMap((r) => r.matches);
  // Partai yang salah satu sisinya BYE lolos otomatis — bukan partai yang dimainkan.
  const playable = matches.filter((m) => !m.a.bye && !m.b.bye);
  const played = playable.filter((m) => m.winner !== null).length;
  return {
    ...stored,
    bracket,
    roundRobin: null,
    matches,
    champion: bracket.champion,
    playedCount: played,
    totalCount: playable.length,
    finished: bracket.champion !== null,
    cost: { ...baseCost, kokPaid: matchesKokPaid(matches) },
  };
}

/** Semua partai yang sudah punya skor, urut sama seperti t.matches (round lalu index). */
export function playedMatches(t: Pick<EnrichedTournament, "matches">): BracketMatch[] {
  return t.matches.filter((m) => m.score);
}

/** Turunkan semua partai dari data mentah turnamen, apa pun formatnya — dipakai buat billing kok per partai. */
export function tournamentMatches(
  t: Pick<StoredTournament, "format" | "size" | "pairs" | "results" | "koks" | "matchKokPaid">,
): BracketMatch[] {
  if (normalizeFormat(t.format) === "round_robin") return buildRoundRobin(t).matches;
  return buildBracket(t).rounds.flatMap((r) => r.matches);
}

/** 4 nama pemain partai ini, urutan tetap [sisiA.a, sisiA.b, sisiB.a, sisiB.b]. Slot BYE/kosong = "". */
export function matchParticipants(m: Pick<BracketMatch, "a" | "b">): string[] {
  return [m.a.pair?.a ?? "", m.a.pair?.b ?? "", m.b.pair?.a ?? "", m.b.pair?.b ?? ""];
}

/** Bagian kok partai ini per orang — sama seperti gameCost().perPerson. */
export function matchKokPerPerson(m: Pick<BracketMatch, "koks">): number {
  return m.koks.reduce((s, k) => s + (Number(k.pricePerPerson) || 0), 0);
}

/** Tanggal partai ini benar-benar dimainkan — skor lama tanpa `playedAt` jatuh ke tanggal mulai turnamen. */
export function matchPlayedDate(t: Pick<StoredTournament, "date">, m: BracketMatch): string {
  return m.score?.playedAt || t.date;
}

/**
 * Id partai "penentu" terakhir — final kalau sudah dimainkan, kalau belum ya
 * partai berskor paling akhir. Dipakai buat nempelin info juara/status lunas
 * ke satu partai saja biar tak berulang di tiap kartu riwayat.
 */
export function finalPlayedMatchId(t: Pick<EnrichedTournament, "matches">): string | null {
  const played = playedMatches(t);
  return played.length ? played[played.length - 1].id : null;
}

/** Status turnamen relatif hari ini — turnamen boleh dijadwalkan ke depan. */
export function tournamentStatus(
  t: Pick<EnrichedTournament, "date" | "endDate" | "finished">,
  today: string,
): "akan-datang" | "berjalan" | "selesai" {
  if (t.finished) return "selesai";
  if (t.date > today) return "akan-datang";
  return "berjalan";
}

/**
 * Judul partai. Knockout pakai nama babak ("Semifinal · Partai 2"); round
 * robin tidak punya babak, jadi dinomori urut.
 */
export function matchTitle(
  t: Pick<StoredTournament, "format" | "size">,
  m: Pick<BracketMatch, "round" | "index">,
): string {
  if (normalizeFormat(t.format) === "round_robin") return `Partai ${m.index + 1}`;
  const slots = bracketSize(normalizeSize(t.size));
  const total = roundCount(slots);
  const count = slots / 2 ** (m.round + 1);
  const label = roundLabel(m.round, total);
  return count > 1 ? `${label} · Partai ${m.index + 1}` : label;
}

/** Saran iuran per orang biar nutup biaya kok — dibulatkan ke atas per 500. */
export function suggestFee(kokTotal: number, participants: number): number {
  if (!(participants > 0) || !(kokTotal > 0)) return 0;
  return Math.ceil(kokTotal / participants / 500) * 500;
}
