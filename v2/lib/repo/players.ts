// Repo pemain — rename cascade + cicilan/lunas (port players routes server.js).

import { prisma } from "@/lib/db";
import { planInstallment, planSettle } from "@/lib/domain/debt";
import { DomainError } from "@/lib/domain/errors";
import { normalizeName } from "@/lib/domain/game";
import type { CarryMap, StoredGame } from "@/lib/domain/types";
import { uid } from "@/lib/domain/util";
import type { Prisma } from "@/lib/generated/prisma/client";
import { rowToGame } from "./mappers";

type JsonArray = Prisma.InputJsonValue;
const PHOTO_RE = /^data:image\/(png|jpe?g|webp);base64,/;

async function recordPaymentTx(
  tx: Prisma.TransactionClient,
  name: string,
  amount: number,
): Promise<void> {
  const amt = Math.round(Number(amount) || 0);
  if (amt <= 0) return;
  await tx.payments.create({ data: { id: uid(), name, amount: amt } });
}

async function loadGamesTx(tx: Prisma.TransactionClient): Promise<StoredGame[]> {
  const rows = await tx.games.findMany();
  return rows.map(rowToGame);
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

/** Terapkan slot yang di-flip paid ke game (grup per gameId, tulis sekali per game). */
async function applyTouchedTx(
  tx: Prisma.TransactionClient,
  games: StoredGame[],
  touched: { gameId: string; index: number }[],
): Promise<void> {
  const byGame = new Map<string, number[]>();
  for (const t of touched) {
    if (!byGame.has(t.gameId)) byGame.set(t.gameId, []);
    byGame.get(t.gameId)!.push(t.index);
  }
  for (const [gameId, indexes] of byGame) {
    const game = games.find((g) => g.id === gameId);
    if (!game) continue;
    for (const i of indexes) game.players[i].paid = true;
    await tx.games.update({
      where: { id: gameId },
      data: { players: game.players as unknown as JsonArray, updated_at: new Date() },
    });
  }
}

/** Bayar sebagian (greedy game terlama dulu). */
export async function payInstallment(name: string, amount: number): Promise<void> {
  const n = normalizeName(name);
  if (!n) throw new DomainError("Nama wajib diisi");
  if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount <= 0) {
    throw new DomainError("Nominal harus angka bulat > 0");
  }
  await prisma.$transaction(async (tx) => {
    const games = await loadGamesTx(tx);
    const carry = await loadCarryTx(tx);
    const plan = planInstallment(games, carry, n, amount);
    await applyTouchedTx(tx, games, plan.touched);
    await writeCarryTx(tx, n, plan.carryAfter);
    await recordPaymentTx(tx, n, plan.paymentAmount);
  });
}

/** Lunasin semua tagihan orang. */
export async function settleAll(name: string): Promise<void> {
  const n = normalizeName(name);
  if (!n) throw new DomainError("Nama wajib diisi");
  await prisma.$transaction(async (tx) => {
    const games = await loadGamesTx(tx);
    const carry = await loadCarryTx(tx);
    const plan = planSettle(games, carry, n);
    await applyTouchedTx(tx, games, plan.touched);
    await writeCarryTx(tx, n, null);
    await recordPaymentTx(tx, n, plan.paymentAmount);
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
