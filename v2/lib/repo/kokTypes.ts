// Repo katalog kok — port routes /api/kok-types* server.js.

import { prisma } from "@/lib/db";
import { DomainError } from "@/lib/domain/errors";
import { normalizeNameType } from "@/lib/domain/game";
import { parseStock } from "@/lib/domain/stock";
import type { KokType } from "@/lib/domain/types";
import { uid } from "@/lib/domain/util";
import { rowToKokType } from "./mappers";

export async function createKokType(input: {
  name?: string;
  pricePerPerson?: number;
  pricePerSlop?: number;
  stock?: number;
  active?: boolean;
}): Promise<KokType> {
  const name = normalizeNameType(input.name);
  if (!name) throw new DomainError("Nama jenis kok wajib diisi");
  const price = Number(input.pricePerPerson);
  if (!Number.isFinite(price) || price < 0) {
    throw new DomainError("pricePerPerson harus angka >= 0");
  }
  if (input.stock !== undefined && (!Number.isFinite(Number(input.stock)) || Number(input.stock) < 0)) {
    throw new DomainError("stock harus angka >= 0");
  }

  const dup = await prisma.kok_types.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
  });
  if (dup) throw new DomainError("Jenis kok dengan nama itu sudah ada", 409);

  const now = new Date();
  const row = await prisma.kok_types.create({
    data: {
      id: uid(),
      name,
      price_per_person: Math.round(price),
      price_per_slop: Math.max(0, Math.round(Number(input.pricePerSlop) || 0)),
      stock: parseStock(input.stock, 0),
      active: input.active === false ? false : true,
      created_at: now,
      updated_at: now,
    },
  });
  return rowToKokType(row);
}

export async function patchKokType(
  id: string,
  input: {
    name?: string;
    pricePerPerson?: number;
    pricePerSlop?: number;
    stock?: number;
    active?: boolean;
  },
): Promise<KokType> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.kok_types.findUnique({ where: { id } });
    if (!existing) throw new DomainError("Jenis kok tidak ditemukan", 404);
    const data: Record<string, unknown> = {};

    if (input.name !== undefined) {
      const name = normalizeNameType(input.name);
      if (!name) throw new DomainError("Nama jenis kok wajib diisi");
      const dup = await tx.kok_types.findFirst({
        where: { name: { equals: name, mode: "insensitive" }, id: { not: id } },
      });
      if (dup) throw new DomainError("Jenis kok dengan nama itu sudah ada", 409);
      data.name = name;
    }
    if (input.pricePerPerson !== undefined) {
      const price = Number(input.pricePerPerson);
      if (!Number.isFinite(price) || price < 0) throw new DomainError("pricePerPerson harus angka >= 0");
      data.price_per_person = Math.round(price);
    }
    if (input.pricePerSlop !== undefined) {
      const ps = Number(input.pricePerSlop);
      if (!Number.isFinite(ps) || ps < 0) throw new DomainError("pricePerSlop harus angka >= 0");
      data.price_per_slop = Math.round(ps);
    }
    if (input.stock !== undefined) {
      const stock = Number(input.stock);
      if (!Number.isFinite(stock) || stock < 0) throw new DomainError("stock harus angka >= 0");
      data.stock = Math.round(stock);
    }
    if (input.active !== undefined) data.active = Boolean(input.active);
    data.updated_at = new Date();

    const row = await tx.kok_types.update({ where: { id }, data });
    return rowToKokType(row);
  });
}

export async function adjustStock(id: string, delta: number): Promise<KokType> {
  if (!Number.isFinite(delta) || !Number.isInteger(delta) || delta === 0) {
    throw new DomainError("delta harus integer non-zero (mis. +12 atau -1)");
  }
  return prisma.$transaction(async (tx) => {
    const existing = await tx.kok_types.findUnique({ where: { id } });
    if (!existing) throw new DomainError("Jenis kok tidak ditemukan", 404);
    const next = (Number(existing.stock) || 0) + delta;
    if (next < 0) throw new DomainError("Stok tidak cukup");
    const row = await tx.kok_types.update({
      where: { id },
      data: { stock: next, updated_at: new Date() },
    });
    return rowToKokType(row);
  });
}

/** Beli stok per slop (1 slop = 12 kok) → tambah stok + catat pengeluaran. */
export async function buyStock(id: string, slops: number, pricePerSlopInput?: number): Promise<void> {
  if (!Number.isFinite(slops) || !Number.isInteger(slops) || slops <= 0) {
    throw new DomainError("Jumlah slop harus angka bulat > 0");
  }
  await prisma.$transaction(async (tx) => {
    const existing = await tx.kok_types.findUnique({ where: { id } });
    if (!existing) throw new DomainError("Jenis kok tidak ditemukan", 404);

    let pricePerSlop =
      pricePerSlopInput !== undefined ? Number(pricePerSlopInput) : Number(existing.price_per_slop) || 0;
    if (!Number.isFinite(pricePerSlop) || pricePerSlop < 0) {
      throw new DomainError("Harga per slop harus angka >= 0");
    }
    pricePerSlop = Math.round(pricePerSlop);
    const amount = slops * pricePerSlop;

    await tx.kok_types.update({
      where: { id },
      data: {
        stock: (Number(existing.stock) || 0) + slops * 12,
        price_per_slop: pricePerSlop,
        updated_at: new Date(),
      },
    });
    await tx.expenses.create({
      data: { id: uid(), type_id: existing.id, type_name: existing.name, slops, amount },
    });
  });
}

export async function deleteKokType(id: string): Promise<void> {
  const res = await prisma.kok_types.deleteMany({ where: { id } });
  if (res.count === 0) throw new DomainError("Jenis kok tidak ditemukan", 404);
}
