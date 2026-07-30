"use server";

import { mutate, type ActionResult } from "@/lib/action-util";
import { requireAdmin } from "@/lib/auth";
import { adjustBalance } from "@/lib/repo/expenses";

export async function adjustBalanceAction(input: {
  note?: string;
  amount: number;
  direction: "in" | "out";
}): Promise<ActionResult> {
  return mutate(async () => {
    await requireAdmin();
    await adjustBalance(input);
  });
}
