"use server";

import { mutate, type ActionResult } from "@/lib/action-util";
import { recordedByFor, requireAdmin } from "@/lib/auth";
import { deletePlayer, payInstallment, settleAll, updatePlayer } from "@/lib/repo/players";

export async function payInstallmentAction(name: string, amount: number): Promise<ActionResult> {
  return mutate(async () => {
    const sess = await requireAdmin();
    await payInstallment(name, Number(amount), recordedByFor(sess));
  });
}

export async function settleAllAction(name: string): Promise<ActionResult> {
  return mutate(async () => {
    const sess = await requireAdmin();
    await settleAll(name, recordedByFor(sess));
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

export async function deletePlayerAction(name: string): Promise<ActionResult> {
  return mutate(async () => {
    await requireAdmin();
    await deletePlayer(name);
  });
}
