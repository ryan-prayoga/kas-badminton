import "server-only";
import { revalidatePath } from "next/cache";
import { DomainError } from "@/lib/domain/errors";
import { publish } from "@/lib/realtime";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; status: number };

/** Jalankan fn, map DomainError → hasil error. Tidak ada side-effect. */
export async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data };
  } catch (e) {
    if (e instanceof DomainError) return { ok: false, error: e.message, status: e.status };
    console.error(e);
    return { ok: false, error: "Server error", status: 500 };
  }
}

/** Seperti run(), tapi kalau sukses → revalidate + broadcast realtime. */
export async function mutate<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  const res = await run(fn);
  if (res.ok) {
    revalidatePath("/", "layout");
    await publish("update");
  }
  return res;
}
