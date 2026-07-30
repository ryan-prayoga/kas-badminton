// Penyesuaian saldo kas manual — di luar beli stok kok (mis. modal tambahan, ambil kas, koreksi selisih).

import { prisma } from "@/lib/db";
import { DomainError } from "@/lib/domain/errors";
import type { PaymentHistoryEntry } from "@/lib/domain/types";
import { uid } from "@/lib/domain/util";

export async function adjustBalance(input: {
  note?: string;
  amount: number;
  direction: "in" | "out";
}): Promise<void> {
  const amount = Math.round(Number(input.amount));
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new DomainError("Jumlah harus angka > 0");
  }
  const note = (input.note ?? "").trim();

  // Kolom `amount` di tabel expenses positif = kas keluar (konsisten dgn beli stok kok).
  // Jadi "tambah saldo" (kas masuk) disimpan negatif → net = paid - expense makin besar.
  const signedAmount = input.direction === "in" ? -amount : amount;

  await prisma.expenses.create({
    data: {
      id: uid(),
      type_id: null,
      type_name: note ? `Penyesuaian: ${note}` : "Penyesuaian saldo",
      slops: 0,
      amount: signedAmount,
    },
  });
}

/** Riwayat penyesuaian saldo manual (bukan beli stok kok) — buat digabung ke riwayat transaksi. */
export async function listBalanceAdjustments(limit = 200): Promise<PaymentHistoryEntry[]> {
  const rows = await prisma.expenses.findMany({
    where: { type_id: null },
    orderBy: { created_at: "desc" },
    take: limit,
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.type_name?.replace(/^Penyesuaian: /, "") || "Penyesuaian saldo",
    amount: Math.abs(r.amount),
    type: r.amount < 0 ? "saldo_masuk" : "saldo_keluar",
    recordedBy: null,
    gameId: null,
    createdAt: r.created_at.toISOString(),
  }));
}
