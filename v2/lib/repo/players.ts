// Repo pemain — rename cascade + cicilan/lunas (port players routes server.js).

import { prisma } from "@/lib/db";
import { planInstallment, planSettle, type TouchedSlot } from "@/lib/domain/debt";
import { DomainError } from "@/lib/domain/errors";
import { normalizeName } from "@/lib/domain/game";
import { syncFees } from "@/lib/domain/tournament";
import type { CarryMap, StoredGame, StoredTournament } from "@/lib/domain/types";
import type { Prisma } from "@/lib/generated/prisma/client";
import { rowToGame, rowToTournament } from "./mappers";
import { recordPaymentTx } from "./payments";

type JsonArray = Prisma.InputJsonValue;
const PHOTO_RE = /^data:image\/(png|jpe?g|webp);base64,/;

async function loadGamesTx(tx: Prisma.TransactionClient): Promise<StoredGame[]> {
  const rows = await tx.games.findMany();
  return rows.map(rowToGame);
}

async function loadTournamentsTx(tx: Prisma.TransactionClient): Promise<StoredTournament[]> {
  const rows = await tx.tournaments.findMany();
  return rows.map(rowToTournament);
}

async function loadCarryTx(tx: Prisma.TransactionClient): Promise<CarryMap> {
  const rows = await tx.player_carry.findMany();
  const carry: CarryMap = {};
  for (const r of rows) {
    const c = Math.max(0, Math.round(Number(r.carry) || 0));
    if (c > 0) carry[r.name] = c;
  }
  return carry;
}

async function writeCarryTx(
  tx: Prisma.TransactionClient,
  name: string,
  value: number | null,
): Promise<void> {
  if (value === null || value <= 0) {
    await tx.player_carry.deleteMany({ where: { name } });
  } else {
    await tx.player_carry.upsert({
      where: { name },
      create: { name, carry: value },
      update: { carry: value },
    });
  }
}

function groupByOwner(touched: TouchedSlot[], kind: TouchedSlot["kind"]): Map<string, number[]> {
  const map = new Map<string, number[]>();
  for (const t of touched) {
    if (t.kind !== kind) continue;
    if (!map.has(t.id)) map.set(t.id, []);
    map.get(t.id)!.push(t.index);
  }
  return map;
}

/**
 * Terapkan slot yang di-flip paid, digrup per game / per turnamen (satu tulis per row).
 * Stempel waktu sama dengan entri ledger-nya biar jam di rekap == jam di history bayar.
 */
async function applyTouchedTx(
  tx: Prisma.TransactionClient,
  games: StoredGame[],
  tournaments: StoredTournament[],
  touched: TouchedSlot[],
  at: Date,
  by?: string,
): Promise<void> {
  const stamp = at.toISOString();

  for (const [gameId, indexes] of groupByOwner(touched, "game")) {
    const game = games.find((g) => g.id === gameId);
    if (!game) continue;
    for (const i of indexes) {
      const p = game.players[i];
      p.paid = true;
      p.paidAt = stamp;
      p.paidBy = by || undefined;
    }
    await tx.games.update({
      where: { id: gameId },
      data: { players: game.players as unknown as JsonArray, updated_at: new Date() },
    });
  }

  for (const [tournamentId, indexes] of groupByOwner(touched, "turnamen")) {
    const t = tournaments.find((x) => x.id === tournamentId);
    if (!t) continue;
    for (const i of indexes) {
      const f = t.fees[i];
      if (!f) continue;
      f.paid = true;
      f.paidAt = stamp;
      f.paidBy = by || undefined;
    }
    await tx.tournaments.update({
      where: { id: tournamentId },
      data: { fees: t.fees as unknown as JsonArray, updated_at: new Date() },
    });
  }
}

/** Bayar sebagian (greedy game terlama dulu). */
export async function payInstallment(name: string, amount: number, by?: string): Promise<void> {
  const n = normalizeName(name);
  if (!n) throw new DomainError("Nama wajib diisi");
  if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount <= 0) {
    throw new DomainError("Nominal harus angka bulat > 0");
  }
  await prisma.$transaction(async (tx) => {
    const games = await loadGamesTx(tx);
    const tournaments = await loadTournamentsTx(tx);
    const carry = await loadCarryTx(tx);
    const plan = planInstallment(games, carry, n, amount, tournaments);
    const at = new Date();
    await applyTouchedTx(tx, games, tournaments, plan.touched, at, by);
    await writeCarryTx(tx, n, plan.carryAfter);
    await recordPaymentTx(tx, {
      name: n,
      amount: plan.paymentAmount,
      // Cicilan yang menutup sisa tagihan tercatat "lunas" di history bayar.
      type: plan.clearsDebt ? "lunas" : "cicil",
      recordedBy: by,
      at,
    });
  });
}

/** Lunasin semua tagihan orang. */
export async function settleAll(name: string, by?: string): Promise<void> {
  const n = normalizeName(name);
  if (!n) throw new DomainError("Nama wajib diisi");
  await prisma.$transaction(async (tx) => {
    const games = await loadGamesTx(tx);
    const tournaments = await loadTournamentsTx(tx);
    const carry = await loadCarryTx(tx);
    const plan = planSettle(games, carry, n, tournaments);
    const at = new Date();
    await applyTouchedTx(tx, games, tournaments, plan.touched, at, by);
    await writeCarryTx(tx, n, null);
    if (plan.touched.length > 0) {
      await recordPaymentTx(tx, {
        name: n,
        amount: plan.paymentAmount,
        type: "lunas",
        recordedBy: by,
        at,
      });
    }
  });
}

/** Rename pemain (cascade ke riwayat + carry + payments) dan/atau ganti foto. */
export async function updatePlayer(
  originalName: string,
  input: { name?: string; photo?: string | null },
): Promise<void> {
  const original = normalizeName(originalName);
  await prisma.$transaction(async (tx) => {
    const player = await tx.players.findUnique({ where: { name: original } });
    if (!player) throw new DomainError("Pemain tidak ditemukan", 404);

    let currentName = original;

    if (input.name !== undefined) {
      const newName = normalizeName(input.name).slice(0, 60);
      if (!newName) throw new DomainError("Nama wajib diisi");
      if (newName.toLowerCase() !== original.toLowerCase()) {
        const dup = await tx.players.findFirst({
          where: { name: { equals: newName, mode: "insensitive" }, NOT: { name: original } },
        });
        if (dup) throw new DomainError("Nama pemain sudah dipakai", 409);

        // cascade ke games
        const games = await loadGamesTx(tx);
        for (const g of games) {
          let touched = false;
          for (const p of g.players) {
            if (p.name === original) {
              p.name = newName;
              touched = true;
            }
          }
          if (touched) {
            await tx.games.update({
              where: { id: g.id },
              data: { players: g.players as unknown as JsonArray, updated_at: new Date() },
            });
          }
        }

        // cascade ke turnamen (nama di bagan + daftar iuran)
        const tournaments = await loadTournamentsTx(tx);
        for (const t of tournaments) {
          let touched = false;
          for (const pair of t.pairs) {
            if (pair.a === original) {
              pair.a = newName;
              touched = true;
            }
            if (pair.b === original) {
              pair.b = newName;
              touched = true;
            }
          }
          if (!touched) continue;
          // syncFees mempertahankan status lunas per nama, jadi rename aman.
          const fees = syncFees(
            t.pairs,
            t.fees.map((f) => (f.name === original ? { ...f, name: newName } : f)),
          );
          await tx.tournaments.update({
            where: { id: t.id },
            data: {
              pairs: t.pairs as unknown as JsonArray,
              fees: fees as unknown as JsonArray,
              updated_at: new Date(),
            },
          });
        }

        // carry merge
        const carry = await loadCarryTx(tx);
        if (carry[original] !== undefined) {
          const merged = Math.max(0, carry[newName] || 0) + Math.max(0, carry[original] || 0);
          await tx.player_carry.deleteMany({ where: { name: original } });
          await writeCarryTx(tx, newName, merged);
        }

        // payments cascade
        await tx.payments.updateMany({ where: { name: original }, data: { name: newName } });

        // rename PK
        await tx.players.update({ where: { name: original }, data: { name: newName } });
        currentName = newName;
      }
    }

    if (input.photo !== undefined) {
      if (input.photo === null) {
        await tx.players.update({ where: { name: currentName }, data: { photo: null } });
      } else if (typeof input.photo === "string") {
        if (!PHOTO_RE.test(input.photo)) throw new DomainError("Format foto tidak didukung");
        if (input.photo.length > 700000) throw new DomainError("Ukuran foto terlalu besar");
        await tx.players.update({ where: { name: currentName }, data: { photo: input.photo } });
      }
    }
  });
}

/** Hapus pemain dari daftar (foto+carry ikut hilang). Riwayat game/pembayaran tetap tersimpan apa adanya. */
export async function deletePlayer(name: string): Promise<void> {
  const n = normalizeName(name);
  if (!n) throw new DomainError("Nama wajib diisi");
  await prisma.$transaction(async (tx) => {
    const player = await tx.players.findUnique({ where: { name: n } });
    if (!player) throw new DomainError("Pemain tidak ditemukan", 404);
    await tx.player_carry.deleteMany({ where: { name: n } });
    await tx.players.delete({ where: { name: n } });
  });
}
