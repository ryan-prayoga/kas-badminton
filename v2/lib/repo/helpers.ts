import type { Prisma } from "@/lib/generated/prisma/client";
import type { KokType } from "@/lib/domain/types";
import { rowToKokType } from "./mappers";

/** Baca kok_types fresh di dalam transaksi (buat cek stok bebas-race). */
export async function readKokTypesTx(tx: Prisma.TransactionClient): Promise<KokType[]> {
  const rows = await tx.kok_types.findMany();
  return rows.map(rowToKokType);
}

/** Terapkan delta stok per type; clamp ke 0 (parity applyStockDelta). */
export async function applyStockDeltasTx(
  tx: Prisma.TransactionClient,
  deltas: Map<string, number>,
): Promise<void> {
  for (const [typeId, delta] of deltas) {
    if (!delta) continue;
    await tx.$executeRaw`
      UPDATE kok_types
      SET stock = GREATEST(0, stock + ${delta}), updated_at = now()
      WHERE id = ${typeId}`;
  }
}

/** Insert nama pemain yang belum ada (case-insensitive), parity rememberPlayers. */
export async function rememberPlayersTx(
  tx: Prisma.TransactionClient,
  names: string[],
): Promise<void> {
  const existing = await tx.players.findMany({ select: { name: true } });
  const set = new Set(existing.map((p) => p.name.toLowerCase()));
  for (const raw of names) {
    const name = raw.trim().replace(/\s+/g, " ");
    if (!name || set.has(name.toLowerCase())) continue;
    await tx.players.create({ data: { name, photo: null } });
    set.add(name.toLowerCase());
  }
}
