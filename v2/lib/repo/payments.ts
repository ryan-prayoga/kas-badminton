// Ledger riwayat bayar — "lunas" (tandai per game / lunasin semua) & "cicil" (bayar sebagian).

import { prisma } from "@/lib/db";
import type { PaymentHistoryEntry, PaymentType } from "@/lib/domain/types";
import { uid } from "@/lib/domain/util";
import type { Prisma, payments as PaymentRow } from "@/lib/generated/prisma/client";

function rowToPayment(r: PaymentRow): PaymentHistoryEntry {
  return {
    id: r.id,
    name: r.name,
    amount: Number(r.amount) || 0,
    type: r.type === "cicil" ? "cicil" : "lunas",
    recordedBy: r.recorded_by,
    gameId: r.game_id,
    createdAt: r.created_at.toISOString(),
  };
}

/** Catat satu event bayar dalam transaksi yang sama dengan mutasi paid-nya. */
export async function recordPaymentTx(
  tx: Prisma.TransactionClient,
  input: { name: string; amount: number; type: PaymentType; recordedBy?: string; gameId?: string },
): Promise<void> {
  await tx.payments.create({
    data: {
      id: uid(),
      name: input.name,
      amount: Math.max(0, Math.round(Number(input.amount) || 0)),
      type: input.type,
      recorded_by: input.recordedBy || null,
      game_id: input.gameId || null,
    },
  });
}

export async function listPaymentHistory(limit = 200): Promise<PaymentHistoryEntry[]> {
  const rows = await prisma.payments.findMany({
    orderBy: { created_at: "desc" },
    take: limit,
  });
  return rows.map(rowToPayment);
}
