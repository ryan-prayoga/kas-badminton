import "server-only";
import { cache } from "react";
import { readSession } from "@/lib/auth";
import { summarize, type SummaryPayload } from "@/lib/domain/summary";
import { loadSnapshot } from "@/lib/repo/snapshot";

export interface AppData extends SummaryPayload {
  me: { role: "admin" | "operator" | null; name?: string };
}

/** Data lengkap sesuai role. cache() = dedupe dalam satu request render. */
export const getData = cache(async (): Promise<AppData> => {
  const sess = await readSession();
  const snap = await loadSnapshot();
  const payload = summarize(snap, sess?.role === "admin");
  return {
    ...payload,
    me: { role: sess?.role ?? null, name: sess?.name },
  };
});
