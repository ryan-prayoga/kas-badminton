"use server";

import { mutate, type ActionResult } from "@/lib/action-util";
import { requireAdmin } from "@/lib/auth";
import { updateSettings, type SettingsView } from "@/lib/repo/settings";

export async function updateSettingsAction(input: {
  defaultPricePerPerson?: number;
  merchantQris?: string;
}): Promise<ActionResult<SettingsView>> {
  return mutate(async () => {
    await requireAdmin();
    return updateSettings(input);
  });
}
