"use server";

import { mutate, type ActionResult } from "@/lib/action-util";
import { requireAdmin } from "@/lib/auth";
import { payInstallment, settleAll, updatePlayer } from "@/lib/repo/players";

export async function payInstallmentAction(name: string, amount: number): Promise<ActionResult> {
  return mutate(async () => {
    await requireAdmin();
    await payInstallment(name, Number(amount));
  });
}

export async function settleAllAction(name: string): Promise<ActionResult> {
  return mutate(async () => {
    await requireAdmin();
    await settleAll(name);
  });
}

export async function updatePlayerAction(
  originalName: string,
  input: { name?: string; photo?: string | null },
): Promise<ActionResult> {
  return mutate(async () => {
    await requireAdmin();
    await updatePlayer(originalName, input);
  });
}
