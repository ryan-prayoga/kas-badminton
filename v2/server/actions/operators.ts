"use server";

import { mutate, run, type ActionResult } from "@/lib/action-util";
import { requireAdmin } from "@/lib/auth";
import {
  createOperator,
  listOperators,
  revokeOperator,
  type OperatorView,
} from "@/lib/repo/operators";

export async function listOperatorsAction(): Promise<ActionResult<OperatorView[]>> {
  return run(async () => {
    await requireAdmin();
    return listOperators();
  });
}

export async function createOperatorAction(input: {
  name?: string;
  expiresAt?: string;
}): Promise<ActionResult<{ operator: { id: string; name: string; expiresAt: string }; pin: string }>> {
  return mutate(async () => {
    await requireAdmin();
    return createOperator(input);
  });
}

export async function revokeOperatorAction(id: string): Promise<ActionResult> {
  return mutate(async () => {
    await requireAdmin();
    await revokeOperator(id);
  });
}
