"use server";

import { mutate, run, type ActionResult } from "@/lib/action-util";
import { requireAdmin } from "@/lib/auth";
import type { KokType } from "@/lib/domain/types";
import {
  adjustStock,
  buyStock,
  createKokType,
  deleteKokType,
  patchKokType,
} from "@/lib/repo/kokTypes";
import { loadSnapshot } from "@/lib/repo/snapshot";

export async function listKokTypesAction(): Promise<ActionResult<KokType[]>> {
  return run(async () => {
    await requireAdmin();
    return (await loadSnapshot()).kokTypes;
  });
}

export async function createKokTypeAction(input: {
  name?: string;
  pricePerPerson?: number;
  pricePerSlop?: number;
  stock?: number;
  active?: boolean;
}): Promise<ActionResult<KokType>> {
  return mutate(async () => {
    await requireAdmin();
    return createKokType(input);
  });
}

export async function patchKokTypeAction(
  id: string,
  input: {
    name?: string;
    pricePerPerson?: number;
    pricePerSlop?: number;
    stock?: number;
    active?: boolean;
  },
): Promise<ActionResult<KokType>> {
  return mutate(async () => {
    await requireAdmin();
    return patchKokType(id, input);
  });
}

export async function adjustStockAction(id: string, delta: number): Promise<ActionResult<KokType>> {
  return mutate(async () => {
    await requireAdmin();
    return adjustStock(id, Number(delta));
  });
}

export async function buyStockAction(
  id: string,
  slops: number,
  pricePerSlop?: number,
): Promise<ActionResult> {
  return mutate(async () => {
    await requireAdmin();
    await buyStock(id, Number(slops), pricePerSlop !== undefined ? Number(pricePerSlop) : undefined);
  });
}

export async function deleteKokTypeAction(id: string): Promise<ActionResult> {
  return mutate(async () => {
    await requireAdmin();
    await deleteKokType(id);
  });
}
