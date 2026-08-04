// Repo turnamen — CRUD bagan, skor, iuran patungan, dan kok (per partai / umum).
// Pola sama seperti repo/games: per-row + transaksi, cek stok fresh di dalam tx.

import { prisma } from "@/lib/db";
import { DomainError } from "@/lib/domain/errors";
import { normalizeKokEntry, normalizeName } from "@/lib/domain/game";
import { stockDeltas, stockDiffError } from "@/lib/domain/stock";
import {
  buildBracket,
  clampToTournament,
  maxGames,
  normalizeMatchScore,
  normalizeScoreFormat,
  normalizeSize,
  roundCount,
  syncFees,
  TOURNAMENT_SIZES,
} from "@/lib/domain/tournament";
import type {
  Kok,
  MatchScore,
  ScoreFormat,
  StoredTournament,
  TournamentKok,
  TournamentPair,
  TournamentSize,
} from "@/lib/domain/types";
import { todayWIB, uid } from "@/lib/domain/util";
import type { Prisma } from "@/lib/generated/prisma/client";
import { rowToTournament } from "./mappers";
import { applyStockDeltasTx, readKokTypesTx, rememberPlayersTx } from "./helpers";
import { recordPaymentTx } from "./payments";

type Json = Prisma.InputJsonValue;

async function getTournamentTx(
  tx: Prisma.TransactionClient,
  id: string,
): Promise<StoredTournament> {
  const row = await tx.tournaments.findUnique({ where: { id } });
  if (!row) throw new DomainError("Turnamen tidak ditemukan", 404);
  return rowToTournament(row);
}

/** Bentuk pasangan dari input UI → slot 0..size-1, id di-generate kalau kosong. */
function buildPairs(raw: Array<{ a?: string; b?: string }> | undefined, size: TournamentSize) {
  const list = raw ?? [];
  return Array.from({ length: size }, (_, slot) => ({
    id: uid(),
    slot,
    a: normalizeName(list[slot]?.a).slice(0, 60),
    b: normalizeName(list[slot]?.b).slice(0, 60),
  }));
}

/** Validasi id partai terhadap ukuran bagan. Balik null kalau bukan partai yang sah. */
function validMatchId(raw: string | null | undefined, size: TournamentSize): string | null {
  if (!raw) return null;
  const m = /^r(\d+)-(\d+)$/.exec(String(raw));
  if (!m) throw new DomainError("Id pertandingan tidak valid");
  const round = Number(m[1]);
  const index = Number(m[2]);
  if (round < 0 || round >= roundCount(size)) throw new DomainError("Babak tidak ada di bagan ini");
  if (index < 0 || index >= size / 2 ** (round + 1)) {
    throw new DomainError("Pertandingan tidak ada di babak ini");
  }
  return `r${round}-${index}`;
}

/** Nama tidak boleh dobel di seluruh bagan — satu orang tidak bisa main di dua pasangan. */
function assertNoDuplicateNames(pairs: TournamentPair[]): void {
  const seen = new Set<string>();
  for (const p of pairs) {
    for (const raw of [p.a, p.b]) {
      const name = normalizeName(raw);
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) throw new DomainError(`Nama "${name}" dipakai lebih dari sekali`);
      seen.add(key);
    }
  }
}

export interface CreateTournamentInput {
  name: string;
  date?: string;
  /** Tanggal selesai kalau turnamen lebih dari sehari. */
  endDate?: string | null;
  size: number;
  fee?: number;
  /** Format skor bawaan buat semua partai turnamen ini. */
  scoreFormat?: ScoreFormat;
  pairs?: Array<{ a?: string; b?: string }>;
  koks?: Array<Partial<Kok>>;
  notes?: string;
  recordedBy: string;
  defaultPrice: number;
}

/** Tanggal selesai wajib >= tanggal mulai; sama persis dianggap sehari (null). */
function normalizeEndDate(start: string, end: string | null | undefined): string | null {
  const e = end ? String(end) : "";
  if (!e || e === start) return null;
  if (e < start) throw new DomainError("Tanggal selesai tidak boleh sebelum tanggal mulai");
  return e;
}

export async function createTournament(input: CreateTournamentInput): Promise<string> {
  const name = normalizeName(input.name).slice(0, 80);
  if (!name) throw new DomainError("Nama turnamen wajib diisi");
  if (!TOURNAMENT_SIZES.includes(Number(input.size) as TournamentSize)) {
    throw new DomainError(`Jumlah pasangan harus ${TOURNAMENT_SIZES.join(" / ")}`);
  }
  const size = normalizeSize(input.size);
  const pairs = buildPairs(input.pairs, size);
  assertNoDuplicateNames(pairs);
  if (pairs.every((p) => !p.a && !p.b)) throw new DomainError("Isi minimal satu pasangan");

  const date = input.date || todayWIB();
  const endDate = normalizeEndDate(date, input.endDate);

  const id = uid();
  await prisma.$transaction(async (tx) => {
    const types = await readKokTypesTx(tx);
    // Kok saat bikin turnamen belum terikat partai — nanti diikat lewat dialog pertandingan.
    const koks: TournamentKok[] = (input.koks ?? []).slice(0, 200).map((k) => ({
      ...normalizeKokEntry(k, input.defaultPrice, types, uid),
      matchId: null,
      date,
    }));
    const stockErr = stockDiffError(types, [], koks);
    if (stockErr) throw new DomainError(stockErr);

    await rememberPlayersTx(
      tx,
      pairs.flatMap((p) => [p.a, p.b]).filter(Boolean),
    );
    await applyStockDeltasTx(tx, stockDeltas([], koks));

    const now = new Date();
    await tx.tournaments.create({
      data: {
        id,
        name,
        date,
        end_date: endDate,
        size,
        fee: Math.max(0, Math.round(Number(input.fee) || 0)),
        score_format: normalizeScoreFormat(input.scoreFormat),
        pairs: pairs as unknown as Json,
        results: {},
        koks: koks as unknown as Json,
        fees: syncFees(pairs, []) as unknown as Json,
        notes: input.notes ? input.notes.trim() : "",
        recorded_by: input.recordedBy,
        created_at: now,
        updated_at: now,
      },
    });
  });
  return id;
}

export interface UpdateTournamentInput {
  name?: string;
  date?: string;
  endDate?: string | null;
  fee?: number;
  scoreFormat?: ScoreFormat;
  notes?: string;
  pairs?: Array<{ a?: string; b?: string }>;
}

export async function updateTournament(id: string, input: UpdateTournamentInput): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const t = await getTournamentTx(tx, id);
    const data: Prisma.tournamentsUpdateInput = { updated_at: new Date() };

    if (input.name !== undefined) {
      const name = normalizeName(input.name).slice(0, 80);
      if (!name) throw new DomainError("Nama turnamen wajib diisi");
      data.name = name;
    }
    // Tanggal mulai & selesai divalidasi berpasangan — pakai nilai lama untuk yang tidak dikirim.
    if (input.date || input.endDate !== undefined) {
      const start = input.date ? String(input.date) : t.date;
      const end = input.endDate !== undefined ? input.endDate : t.endDate;
      data.date = start;
      data.end_date = normalizeEndDate(start, end);
    }
    if (input.notes !== undefined) data.notes = String(input.notes || "").trim();
    if (input.fee !== undefined) {
      const fee = Math.round(Number(input.fee));
      if (!Number.isFinite(fee) || fee < 0) throw new DomainError("Iuran harus angka >= 0");
      data.fee = fee;
    }
    // Cuma ubah bawaan buat partai berikutnya — skor yang sudah tercatat simpan formatnya sendiri.
    if (input.scoreFormat !== undefined) data.score_format = normalizeScoreFormat(input.scoreFormat);

    if (input.pairs) {
      const pairs = buildPairs(input.pairs, t.size).map((p, i) => ({
        ...p,
        // Pertahankan id slot lama biar referensi di UI stabil.
        id: t.pairs[i]?.id ?? p.id,
      }));
      assertNoDuplicateNames(pairs);
      const fees = syncFees(pairs, t.fees);
      await rememberPlayersTx(
        tx,
        pairs.flatMap((p) => [p.a, p.b]).filter(Boolean),
      );
      data.pairs = pairs as unknown as Json;
      data.fees = fees as unknown as Json;
    }

    await tx.tournaments.update({ where: { id }, data });
  });
}

export async function deleteTournament(id: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const t = await getTournamentTx(tx, id);
    // Kok balik ke stok, sama seperti hapus game.
    await applyStockDeltasTx(tx, stockDeltas(t.koks, []));
    await tx.tournaments.delete({ where: { id } });
  });
}

// --- Skor ---

/** Set skor satu pertandingan. Kirim null buat menghapus (kembali "belum dimainkan"). */
export async function setMatchScore(
  id: string,
  match: string,
  score: MatchScore | null,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const t = await getTournamentTx(tx, id);
    const key = validMatchId(match, t.size);
    if (!key) throw new DomainError("Id pertandingan tidak valid");
    const [round, index] = key.slice(1).split("-").map(Number);

    const results = { ...t.results };
    if (score === null) {
      delete results[key];
    } else {
      const format = normalizeScoreFormat(score.format);
      const raw = Array.isArray(score.games) ? score.games : [];
      if (raw.length > maxGames(format)) {
        throw new DomainError(
          format === "bo3" ? "Maksimal 3 game" : "Format sampai 30 cuma 1 game",
        );
      }
      for (const g of raw) {
        const a = Number(g?.a);
        const b = Number(g?.b);
        if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) {
          throw new DomainError("Skor harus angka bulat >= 0");
        }
        if (a > 99 || b > 99) throw new DomainError("Skor maksimal 99");
        // Game yang diisi tapi seri bikin pemenangnya gantung — tolak lebih awal.
        if (a === b && a > 0) throw new DomainError("Skor game tidak boleh seri");
      }
      // normalizeMatchScore membuang game 0-0; kalau habis semua berarti belum dimainkan.
      const normalized = normalizeMatchScore({ format, games: raw });
      if (normalized) results[key] = normalized;
      else delete results[key];
    }

    // Kalau pemenang match ini berubah, hasil babak setelahnya jadi tidak valid
    // (lawannya beda orang) — buang biar bagan tidak menampilkan skor palsu.
    // Koreksi skor yang pemenangnya tetap sama tidak mengganggu babak lanjutan.
    const findMatch = (r: Record<string, MatchScore>) =>
      buildBracket({ size: t.size, pairs: t.pairs, results: r }).rounds[round].matches[index];
    const before = findMatch(t.results);
    const after = findMatch(results);
    const winnerId = (m: typeof before) =>
      m.winner ? ((m.winner === "a" ? m.a.pair : m.b.pair)?.id ?? null) : null;
    if (winnerId(before) !== winnerId(after)) {
      for (const k of Object.keys(results)) {
        const parsed = /^r(\d+)-/.exec(k);
        if (parsed && Number(parsed[1]) > round) delete results[k];
      }
    }

    await tx.tournaments.update({
      where: { id },
      data: { results: results as unknown as Json, updated_at: new Date() },
    });
  });
}

// --- Iuran patungan ---

export async function setFeePaid(
  id: string,
  index: number,
  paid: boolean,
  by?: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const t = await getTournamentTx(tx, id);
    const fee = t.fees[index];
    if (!Number.isInteger(index) || !fee) throw new DomainError("Peserta tidak ditemukan", 404);

    if (paid) {
      const at = new Date();
      fee.paid = true;
      fee.paidAt = at.toISOString();
      fee.paidBy = by || undefined;
      await recordPaymentTx(tx, {
        name: fee.name,
        amount: t.fee,
        type: "lunas",
        recordedBy: by,
        tournamentId: id,
        at,
      });
    } else {
      fee.paid = false;
      fee.paidAt = undefined;
      fee.paidBy = undefined;
    }

    await tx.tournaments.update({
      where: { id },
      data: { fees: t.fees as unknown as Json, updated_at: new Date() },
    });
  });
}

export async function setAllFeesPaid(id: string, paid: boolean, by?: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const t = await getTournamentTx(tx, id);
    const at = new Date();
    const stamp = at.toISOString();
    for (const fee of t.fees) {
      if (!paid) {
        fee.paid = false;
        fee.paidAt = undefined;
        fee.paidBy = undefined;
        continue;
      }
      // Sudah lunas sebelumnya → pertahankan waktu asli, jangan dobel catat di ledger.
      if (fee.paid && fee.paidAt) continue;
      fee.paid = true;
      fee.paidAt = stamp;
      fee.paidBy = by || undefined;
      await recordPaymentTx(tx, {
        name: fee.name,
        amount: t.fee,
        type: "lunas",
        recordedBy: by,
        tournamentId: id,
        at,
      });
    }
    await tx.tournaments.update({
      where: { id },
      data: { fees: t.fees as unknown as Json, updated_at: new Date() },
    });
  });
}

// --- Kok (per partai / umum) ---

/**
 * Tambah kok ke turnamen. `matchId` mengikat kok ke satu partai — tiap partai
 * boleh pakai jenis & harga yang beda. Kirim null untuk kok umum turnamen.
 * `date` = hari kok itu dipakai; di luar rentang turnamen otomatis dijepit.
 */
export async function addTournamentKoks(
  id: string,
  raw: Array<Partial<Kok>>,
  defaultPrice: number,
  matchId?: string | null,
  date?: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const t = await getTournamentTx(tx, id);
    const types = await readKokTypesTx(tx);
    const boundTo = validMatchId(matchId, t.size);
    const usedAt = clampToTournament(date ?? todayWIB(), t.date, t.endDate);
    const added: TournamentKok[] = raw.slice(0, 200).map((k) => ({
      ...normalizeKokEntry(k, defaultPrice, types, uid),
      matchId: boundTo,
      date: usedAt,
    }));
    if (added.length === 0) throw new DomainError("Minimal 1 kok");
    if (t.koks.length + added.length > 500) throw new DomainError("Kok turnamen maksimal 500");
    const stockErr = stockDiffError(types, [], added);
    if (stockErr) throw new DomainError(stockErr);

    await applyStockDeltasTx(tx, stockDeltas([], added));
    await tx.tournaments.update({
      where: { id },
      data: { koks: [...t.koks, ...added] as unknown as Json, updated_at: new Date() },
    });
  });
}

export async function removeTournamentKok(id: string, kokId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const t = await getTournamentTx(tx, id);
    const removed = t.koks.find((k) => k.id === kokId);
    if (!removed) throw new DomainError("Kok tidak ditemukan", 404);
    const koks = t.koks.filter((k) => k.id !== kokId);
    if (removed.typeId) await applyStockDeltasTx(tx, new Map([[removed.typeId, 1]]));
    await tx.tournaments.update({
      where: { id },
      data: { koks: koks as unknown as Json, updated_at: new Date() },
    });
  });
}

export async function getTournament(id: string): Promise<StoredTournament | null> {
  const row = await prisma.tournaments.findUnique({ where: { id } });
  return row ? rowToTournament(row) : null;
}
